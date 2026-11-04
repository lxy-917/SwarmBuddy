import { Eye, EyeOff, Plus, Trash2, Pen } from 'lucide-react';
import { ContextMenu } from 'radix-ui';
import { useState, useEffect, useLayoutEffect, useCallback } from 'react';

import { credentialFieldLabel } from './credentialFieldText';
import { readChatCredentialPreference, saveChatCredentialPreference } from './credentialPreference';
import './credential-theme.css';
import { credentialApi, embeddingModelApi, modelApi, ttsModelApi } from '@/api';
import type {
	ChatModelConfig,
	CredentialView,
	CredentialSchema,
	EmbeddingModelCard,
	ModelCard,
	TTSModelCard,
} from '@/api';
import { CreateCredentialDialog } from '@/components/dialog/CreateCredentialDialog';
import { DeleteDialog } from '@/components/dialog/DeleteDialog';
import { EditCredentialDialog } from '@/components/dialog/EditCredentialDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAvailableModels } from '@/hooks/useAvailableModels';
import { useCredentials } from '@/hooks/useCredentials';
import { useSessions } from '@/hooks/useSessions';
import { useTranslation } from '@/i18n/useI18n';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/utils/common.ts';

/** 详情面板当前展示的模型类别。 */
type ModelTab = 'llm' | 'tts' | 'embedding';

const ADD_PROVIDER_TYPES = [
	'dashscope_credential',
	'deepseek_credential',
	'gemini_credential',
	'anthropic_credential',
	'openai_credential',
] as const;

const PROVIDER_LOGOS: Record<string, string> = {
	dashscope_credential: '/provider-logos/dashscope.svg',
	deepseek_credential: '/provider-logos/deepseek.svg',
	gemini_credential: '/provider-logos/gemini.svg',
	anthropic_credential: '/provider-logos/anthropic.svg',
	openai_credential: '/provider-logos/openai.svg',
};

/** 模型表格中的一行，可对应三种模型卡片。 */
type ModelRow = ModelCard | TTSModelCard | EmbeddingModelCard;

// ─── 脱敏显示 ────────────────────────────────────────────────────────────────

function MaskedValue({ value }: { value: string }) {
	const [visible, setVisible] = useState(false);
	const masked = value.length > 8 ? value.slice(0, 4) + '••••••••' + value.slice(-4) : '••••••••';
	return (
		<span className="credential-field-secret">
			<span className="credential-field-secret-text">{visible ? value : masked}</span>
			<Button
				size={'icon-sm'}
				className="text-text-tertiary hover:text-foreground"
				variant={'ghost'}
				aria-label={visible ? '隐藏密钥' : '显示密钥'}
				onClick={() => setVisible((v) => !v)}
			>
				{visible ? <EyeOff /> : <Eye />}
			</Button>
		</span>
	);
}

// ─── Model table ──────────────────────────────────────────────────────────────

/** 输入和输出列中单独显示的主要 MIME 类型。 */
const MODALITIES = new Set(['text', 'image', 'video', 'audio']);

/** 标记模型具有推理能力，并非真正的输入模态。 */
const THINKING_TYPE = 'application/x-thinking';

/** 嵌入模型输出的稠密向量。 */
const EMBEDDING_TYPE = 'application/x-embedding';

/**
 * 将模型支持的 MIME 列表压缩为简短模态标签。四类媒体之外的格式
 * （如 PDF 和办公文档）统一显示为 `file`，避免表格单元格过长。
 *
 * @param types 模型卡片中的 MIME 类型。
 * @returns 按出现顺序去重后的标签。
 */
function modalities(types: string[]): string[] {
	const out = new Set<string>();
	for (const type of types) {
		if (type === THINKING_TYPE) continue;
		if (type === EMBEDDING_TYPE) {
			out.add('vector');
			continue;
		}
		const main = type.split('/')[0];
		out.add(MODALITIES.has(main) ? main : 'file');
	}
	return [...out];
}

/** 模型名称旁的行内标签，用于显示推理、实时能力或状态。 */
function ModelTag({ children }: { children: React.ReactNode }) {
	return (
		<span className="rounded bg-surface-muted px-1.75 py-0.5 font-mono text-[9px] tracking-[0.06em] uppercase text-text-secondary">
			{children}
		</span>
	);
}

function HeadCell({ children }: { children: React.ReactNode }) {
	return (
		<TableHead className="h-auto bg-muted px-4 py-2.25 font-mono text-[9.5px] font-normal tracking-widest uppercase text-text-tertiary">
			{children}
		</TableHead>
	);
}

/** 数值或模态单元格，使用等宽字体并与表头区分明暗。 */
function DataCell({ children, size }: { children: React.ReactNode; size: '11' | '11.5' }) {
	return (
		<TableCell
			className={cn(
				'px-4 py-2.5 font-mono text-text-secondary',
				size === '11' ? 'text-[11px]' : 'text-[11.5px]',
			)}
		>
			{children}
		</TableCell>
	);
}

interface ModelTableProps {
	/** 待渲染的行，其数据结构须与 `variant` 一致。 */
	models: ModelRow[];
	/** 决定模型名称与输入模态之间展示哪些数值列。 */
	variant: ModelTab;
}

/**
 * 将模型列表显示为表格：每个模型占一行，容量与模态分别占列。
 *
 * @param models 待渲染的模型行。
 * @param variant 要使用的列配置。
 * @returns 带边框的表格及其图例。
 */
function ModelTable({ models, variant }: ModelTableProps) {
	const { t } = useTranslation();
	const isChat = variant === 'llm';
	const isEmbedding = variant === 'embedding';

	return (
		<div>
			<div className="overflow-x-auto rounded-[16px] border border-border">
				<Table className="min-w-[500px]">
					<TableHeader>
						<TableRow className="border-border hover:bg-transparent">
							<HeadCell>{t('credential.table.model')}</HeadCell>
							{(isChat || isEmbedding) && (
								<HeadCell>{t('credential.table.context')}</HeadCell>
							)}
							{isChat && <HeadCell>{t('credential.table.maxOutput')}</HeadCell>}
							{isEmbedding && <HeadCell>{t('credential.table.dimensions')}</HeadCell>}
							<HeadCell>{t('credential.table.accepts')}</HeadCell>
							<HeadCell>{t('credential.table.outputs')}</HeadCell>
						</TableRow>
					</TableHeader>
					<TableBody>
						{models.map((model) => {
							const chat = isChat ? (model as ModelCard) : null;
							const embed = isEmbedding ? (model as EmbeddingModelCard) : null;
							const tts = variant === 'tts' ? (model as TTSModelCard) : null;
							const context = chat?.context_size ?? embed?.context_size;
							return (
								<TableRow
									key={model.name}
									className="border-border hover:bg-row-hover"
								>
									<TableCell className="px-4 py-2.5 text-[12.5px] text-foreground">
										<span className="flex items-center gap-x-2">
											<span
												className="min-w-0 flex-1 truncate"
												title={model.name}
											>
												{model.label || model.name}
											</span>
											{model.input_types.includes(THINKING_TYPE) && (
												<ModelTag>{t('credential.reasoning')}</ModelTag>
											)}
											{tts?.realtime && (
												<ModelTag>{t('credential.realtime')}</ModelTag>
											)}
											{model.status !== 'active' && (
												<ModelTag>{model.status}</ModelTag>
											)}
										</span>
									</TableCell>
									{(isChat || isEmbedding) && (
										<DataCell size="11.5">
											{context ? formatNumber(context) : '—'}
										</DataCell>
									)}
									{isChat && (
										<DataCell size="11.5">
											{chat?.output_size
												? formatNumber(chat.output_size)
												: '—'}
										</DataCell>
									)}
									{isEmbedding && (
										<DataCell size="11.5">{embed?.dimensions ?? '—'}</DataCell>
									)}
									<DataCell size="11">
										{modalities(model.input_types).join(' · ') || '—'}
									</DataCell>
									<DataCell size="11">
										{modalities(model.output_types).join(' · ') || '—'}
									</DataCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
			<p className="mt-2.5 text-[11px] text-muted-foreground">
				{t('credential.table.legend')}
			</p>
		</div>
	);
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
	credential: CredentialView;
	schema: CredentialSchema | null;
	onEdit: () => void;
	onDelete: () => void;
}

function DetailPanel({ credential, schema, onEdit, onDelete }: DetailPanelProps) {
	const { t } = useTranslation();
	const [models, setModels] = useState<ModelCard[]>([]);
	const [ttsModels, setTtsModels] = useState<TTSModelCard[]>([]);
	const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelCard[]>([]);
	const [modelsLoading, setModelsLoading] = useState(false);
	const [tab, setTab] = useState<ModelTab>('llm');

	const type = credential.data.type as string | undefined;
	const shown = tab === 'llm' ? models : tab === 'tts' ? ttsModels : embeddingModels;
	const total = models.length + ttsModels.length + embeddingModels.length;

	// 切换凭证后，新服务商可能没有语音合成模型；此时重置到语言模型标签。
	useEffect(() => setTab('llm'), [credential.id]);

	useEffect(() => {
		if (!type) return;
		setModelsLoading(true);
		Promise.all([
			modelApi
				.list(type)
				.then((res) => res.models)
				.catch(() => [] as ModelCard[]),
			ttsModelApi
				.list(type)
				.then((res) => res.models)
				.catch(() => [] as TTSModelCard[]),
			embeddingModelApi
				.list(type)
				.then((res) => res.models)
				.catch(() => [] as EmbeddingModelCard[]),
		])
			.then(([chatModels, tts, embeddings]) => {
				setModels(chatModels);
				setTtsModels(tts);
				setEmbeddingModels(embeddings);
			})
			.finally(() => setModelsLoading(false));
	}, [credential.id, type]);

	// 按 Schema 字段顺序显示，跳过 id、type 和常量字段。
	const displayFields = schema
		? Object.entries(schema.properties).filter(
				([key, prop]) => key !== 'id' && key !== 'type' && prop.const === undefined,
			)
		: Object.entries(credential.data)
				.filter(([key]) => key !== 'id' && key !== 'type')
				.map(
					([key]) =>
						[key, { title: key, writeOnly: false }] as [
							string,
							{ title: string; writeOnly: boolean },
						],
				);

	const name = (credential.data.name as string | undefined) ?? credential.id;

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="shrink-0 flex items-start justify-between gap-x-4 p-[18px_18px_16px]">
				<div className="flex flex-col gap-y-1">
					<span className="text-foreground text-lg font-medium tracking-[-0.015em]">
						{name}
					</span>
					<span className="font-mono text-text-data text-sm">{type}</span>
					{!credential.editable && (
						<Badge variant="secondary" title={t('common.readOnlyTooltip')}>
							{t('common.readOnly')}
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-x-2 shrink-0">
					<Button
						size="icon-sm"
						variant="ghost"
						className="text-text-tertiary hover:text-foreground"
						onClick={onEdit}
						disabled={!credential.editable}
						tooltip={credential.editable ? undefined : t('common.readOnlyTooltip')}
					>
						<Pen />
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="credential-delete-button"
						onClick={onDelete}
						disabled={!credential.editable}
						tooltip={credential.editable ? undefined : t('common.readOnlyTooltip')}
					>
						<Trash2 /> {t('credential.deleteAction')}
					</Button>
				</div>
			</div>

			<Separator className="shrink-0" />

			<div className="min-h-0 flex-1 overflow-y-auto">
				{/* Fields */}
				<div className="credential-fields flex flex-col p-[22px_22px_0]">
					{displayFields.map(([key, prop]) => {
						const schemaProp = prop as {
							title?: string;
							writeOnly?: boolean;
							format?: string;
						};
						const label = credentialFieldLabel(key, schemaProp.title);
						const isSecret = schemaProp.writeOnly || schemaProp.format === 'password';
						const val = credential.data[key];
						if (val === undefined || val === null) return null;
						const strVal = String(val);
						return (
							<div
								key={key}
								className="credential-field-row"
							>
								<span className="credential-field-label">
									{label}
								</span>
								{isSecret ? (
									<MaskedValue value={strVal} />
								) : (
									<span className="credential-field-value">
										{strVal}
									</span>
								)}
							</div>
						);
					})}
				</div>

				{/* Available Models */}
				<Tabs
					value={tab}
					onValueChange={(v) => setTab(v as ModelTab)}
					className="gap-0 px-[18px] pb-6"
				>
					<div className="mt-[30px] mb-3 flex flex-wrap items-center justify-between gap-3">
						<span className="flex items-center gap-x-2 text-[13.5px] font-medium text-foreground">
							{t('credential.availableModels')}
							<span className="font-mono text-[11px] text-text-data">{total}</span>
						</span>
						<div className="flex flex-wrap items-center gap-2">
							{/* Only worth a switch when there is a second list to switch to. */}
							{(ttsModels.length > 0 || embeddingModels.length > 0) && (
								<TabsList className="bg-surface-muted">
								{/* Only the shadow is overridden here; the stock one
							    is shadow-sm. */}
								<TabsTrigger
									value="llm"
									className="px-2.5 text-[11.5px] text-muted-foreground group-data-[variant=default]/tabs-list:data-active:shadow-tab!"
								>
									{t('common.llm')}
									<span className="font-mono text-[10px] text-text-data">
										{models.length}
									</span>
								</TabsTrigger>
								{ttsModels.length > 0 && (
									<TabsTrigger
										value="tts"
										className="px-2.5 text-[11.5px] text-muted-foreground group-data-[variant=default]/tabs-list:data-active:shadow-tab!"
									>
										{t('common.tts')}
										<span className="font-mono text-[10px] text-text-data">
											{ttsModels.length}
										</span>
									</TabsTrigger>
								)}
								{embeddingModels.length > 0 && (
									<TabsTrigger
										value="embedding"
										className="px-2.5 text-[11.5px] text-muted-foreground group-data-[variant=default]/tabs-list:data-active:shadow-tab!"
									>
										{t('common.embedding')}
										<span className="font-mono text-[10px] text-text-data">
											{embeddingModels.length}
										</span>
									</TabsTrigger>
								)}
								</TabsList>
							)}
						</div>
					</div>

					{modelsLoading ? (
						<Skeleton className="h-40 rounded-[16px]" />
					) : shown.length === 0 ? (
						<Empty className="border-none py-6">
							<EmptyHeader>
								<EmptyTitle>{t('credential.noModels')}</EmptyTitle>
								<EmptyDescription>
									{t('credential.noModelsDescription')}
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<>
							<TabsContent value="llm">
								<ModelTable models={models} variant="llm" />
							</TabsContent>
							<TabsContent value="tts">
								<ModelTable models={ttsModels} variant="tts" />
							</TabsContent>
							<TabsContent value="embedding">
								<ModelTable models={embeddingModels} variant="embedding" />
							</TabsContent>
						</>
					)}
				</Tabs>
			</div>
		</div>
	);
}

// ─── 凭证页面 ────────────────────────────────────────────────────────────────

export const CredentialPage = () => {
	const { t } = useTranslation();
	const { credentials, loading, remove, update, refetch } = useCredentials();
	const { groups: availableModels } = useAvailableModels();
	const params = new URLSearchParams(window.location.search);
	const agentId = params.get('agent_id') || null;
	const sessionId = params.get('session_id') || null;
	const { sessions, update: updateSession, refetch: refetchSessions } = useSessions(agentId);
	const session = sessions.find((item) => item.session.id === sessionId);
	const currentConfig = session?.session.config.chat_model_config;
	const [preferredConfig, setPreferredConfig] = useState(() => readChatCredentialPreference());
	const [applying, setApplying] = useState(false);
	const [selectionError, setSelectionError] = useState<string | null>(null);
	const modelChoices = Object.entries(availableModels).flatMap(([type, records]) => records.flatMap(({ credential, models }) => models.filter((model) => model.type === 'chat_model' && model.status === 'active').map((model) => ({ type, credential, model }))));
	const effectiveConfig = sessionId ? currentConfig : preferredConfig;
	const busy = session?.status != null && session.status !== 'idle';
	const [schemas, setSchemas] = useState<CredentialSchema[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [createDefaultType, setCreateDefaultType] = useState<string | undefined>();
	const [editOpen, setEditOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<CredentialView | null>(null);
	const [renameTarget, setRenameTarget] = useState<CredentialView | null>(null);
	const [renameName, setRenameName] = useState('');
	const [renaming, setRenaming] = useState(false);

	useLayoutEffect(() => {
		const root = document.documentElement;
		const wasDark = root.classList.contains('dark');
		root.classList.add('dark', 'swarm-credential-theme');
		return () => {
			root.classList.remove('swarm-credential-theme');
			if (!wasDark) root.classList.remove('dark');
		};
	}, []);

	useEffect(() => {
		credentialApi.schemas().then((res) => setSchemas(res.schemas));
	}, []);

	// 未选中凭证时，默认选中第一项。
	useEffect(() => {
		if (!selectedId && credentials.length > 0) {
			setSelectedId(credentials[0].id);
		}
	}, [credentials, selectedId]);

	const applySelection = async (credentialId: string) => {
		if (applying || busy || effectiveConfig?.credential_id === credentialId) return;
		const choices = modelChoices.filter((choice) => choice.credential.id === credentialId);
		const draftChoice = choices.find((choice) => choice.model.name === effectiveConfig?.model) ?? choices[0];
		if (!draftChoice) {
			setSelectionError('该凭证暂无可用聊天模型。');
			return;
		}
		const sameModel = effectiveConfig?.type === draftChoice.type && effectiveConfig.model === draftChoice.model.name;
		const properties = (draftChoice.model.parameter_schema as { properties?: Record<string, unknown> }).properties ?? {};
		const config: ChatModelConfig = {
			type: draftChoice.type,
			credential_id: draftChoice.credential.id,
			model: draftChoice.model.name,
			parameters: sameModel ? (effectiveConfig?.parameters ?? {}) : {
				...(Object.hasOwn(properties, 'thinking_enable') ? { thinking_enable: false } : {}),
				...(draftChoice.type === 'dashscope_credential' && Object.hasOwn(properties, 'search_enable') ? { search_enable: false } : {}),
			},
		};
		setApplying(true);
		setSelectionError(null);
		try {
			if (agentId && sessionId) {
				await updateSession(sessionId, { chat_model_config: config });
				await refetchSessions();
			} else {
				saveChatCredentialPreference(config);
				setPreferredConfig(config);
			}
			setSelectedId(credentialId);
			window.parent.postMessage({ type: 'swarmbuddy:credential-selection-updated' }, window.location.origin);
		} catch (error) {
			setSelectionError(error instanceof Error ? error.message : '切换凭证失败');
		} finally {
			setApplying(false);
		}
	};

	const selectedCredential = credentials.find((c) => c.id === selectedId) ?? null;
	const selectedSchema = selectedCredential
		? (schemas.find(
				(s) =>
					(s.properties.type?.const as string) ===
					(selectedCredential.data.type as string),
			) ?? null)
		: null;

	// 按类型分组凭证，并保留尚未配置的 Schema 类型。
	const groupedByType: Array<{ type: string; title: string; records: CredentialView[] }> =
		schemas.map((s) => {
			const type = s.properties.type?.const as string;
			return {
				type,
				title: s.title,
				records: credentials.filter((c) => c.data.type === type),
			};
		});

	// 优先展示已配置的服务商，避免大量未配置项淹没当前凭证。
	const configuredGroups = groupedByType.filter((g) => g.records.length > 0);
	const addableGroups = ADD_PROVIDER_TYPES.flatMap((type) => {
		const group = groupedByType.find((item) => item.type === type);
		return group ? [group] : [];
	});
	const totalConfigured = configuredGroups.reduce((n, g) => n + g.records.length, 0);

	const handleOpenCreate = (type?: string) => {
		setCreateDefaultType(type);
		setCreateOpen(true);
	};

	const openRename = (credential: CredentialView) => {
		if (!credential.editable) return;
		setRenameName(String(credential.data.name ?? ''));
		setRenameTarget(credential);
	};

	const handleRename = useCallback(async () => {
		const name = renameName.trim();
		if (!renameTarget?.editable || !name || renaming) return;
		setRenaming(true);
		try {
			await update(renameTarget.id, { data: { ...renameTarget.data, name } });
			setRenameTarget(null);
		} finally {
			setRenaming(false);
		}
	}, [renameName, renameTarget, renaming, update]);

	const handleDelete = useCallback(async () => {
		if (!deleteTarget?.editable) return;
		await remove(deleteTarget.id);
		setSelectedId((current) => current === deleteTarget.id ? null : current);
	}, [deleteTarget, remove]);

	return (
		<div className="credential-surface flex h-full w-full p-2 gap-2">
			{/* Left sidebar */}
			<Sidebar collapsible="none" className="rounded-[22px]">
				<SidebarHeader className={'flex flex-col p-[20px_18px_14px] gap-y-1'}>
					<div className="text-xl font-medium tracking-[-0.02em] text-foreground">
						{t('common.credential')}
					</div>
					<div className="text-text-tertiary text-xs">{t('credential.subtitle')}</div>
				</SidebarHeader>
				{/*<Separator />*/}
				<SidebarContent>
					{selectionError && <div className="credential-use-error" role="alert">{selectionError}</div>}
					{loading ? (
						<div className="flex flex-col gap-y-2 p-4">
							{Array.from({ length: 3 }).map((_, i) => (
								<Skeleton key={i} className="h-8 rounded" />
							))}
						</div>
					) : groupedByType.length === 0 ? (
						<Empty className="border-none py-8">
							<EmptyHeader>
								<EmptyTitle>{t('credential.noProviders')}</EmptyTitle>
							</EmptyHeader>
						</Empty>
					) : (
						<>
							{/* Configured credentials lead — this is what the user actually set up. */}
							{configuredGroups.length > 0 && (
								<SidebarGroup className="mt-6 px-2 py-0">
									<SidebarGroupLabel className="justify-between">
										{t('credential.configured')}
										<span className="text-[10px] text-text-data font-mono">
											{totalConfigured}
										</span>
									</SidebarGroupLabel>
									<SidebarGroupContent>
										{configuredGroups.map(({ type, title, records }) => (
											<SidebarGroup key={type} className="mt-3 px-0 py-0">
												<SidebarGroupLabel>{title}</SidebarGroupLabel>
												<SidebarGroupContent>
													<SidebarMenu>
														{records.map((rec) => {
															const name =
																(rec.data.name as
																	| string
																	| undefined) ?? rec.id;
															return (
																<ContextMenu.Root key={rec.id}>
																<ContextMenu.Trigger asChild>
																<SidebarMenuItem>
																	<SidebarMenuButton
																		className={rec.editable ? 'pr-8' : undefined}
																		isActive={
																			selectedId === rec.id
																		}
																		onClick={() =>
																			setSelectedId(rec.id)
																		}
																		onDoubleClick={() => void applySelection(rec.id)}
																		title={effectiveConfig?.credential_id === rec.id ? `${name} · 使用中` : `双击使用 ${name}`}
																	>
																		<span className="min-w-0 flex-1 truncate">
																			{name}
																		</span>
																		{effectiveConfig?.credential_id === rec.id && <span className="credential-active-label">使用中</span>}
																		{!rec.editable && (
																			<Badge
																				variant="secondary"
																				className="text-[10px] px-1 py-0"
																				title={t(
																					'common.readOnlyTooltip',
																				)}
																			>
																				{t(
																					'common.readOnly',
																				)}
																			</Badge>
																		)}
																	</SidebarMenuButton>
																	{rec.editable && <SidebarMenuAction showOnHover className="credential-row-delete" type="button" title={`${t('credential.deleteAction')}：${name}`} aria-label={`${t('credential.deleteAction')}：${name}`} onClick={() => setDeleteTarget(rec)}><Trash2 /></SidebarMenuAction>}
																</SidebarMenuItem>
																</ContextMenu.Trigger>
																<ContextMenu.Portal><ContextMenu.Content className="credential-context-menu" onKeyDown={(event) => {
																	if (!rec.editable) return;
																	if (event.altKey && event.ctrlKey && event.key.toLowerCase() === 'r') { event.preventDefault(); openRename(rec); }
																	if (event.key === 'Delete') { event.preventDefault(); setDeleteTarget(rec); }
																}}>
																	<ContextMenu.Item className="credential-context-item" disabled={!rec.editable} onSelect={() => openRename(rec)}><Pen size={15} /><span>{t('credential.renameAction')}</span><kbd>Alt+Ctrl+R</kbd></ContextMenu.Item>
																	<ContextMenu.Separator className="credential-context-separator" />
																	<ContextMenu.Item className="credential-context-item credential-context-danger" disabled={!rec.editable} onSelect={() => setDeleteTarget(rec)}><Trash2 size={15} /><span>{t('credential.deleteAction')}</span><kbd>Delete</kbd></ContextMenu.Item>
																</ContextMenu.Content></ContextMenu.Portal>
																</ContextMenu.Root>
															);
														})}
													</SidebarMenu>
												</SidebarGroupContent>
											</SidebarGroup>
										))}
									</SidebarGroupContent>
								</SidebarGroup>
							)}

							{/* Add credential — every provider is an entry point (including
							    configured ones, to add more under the same provider). */}
							<SidebarGroup className="mt-5 px-2 py-0">
								<SidebarGroupLabel>{t('credential.addProvider')}</SidebarGroupLabel>
								<SidebarGroupContent>
									<SidebarMenu>
										{addableGroups.map(({ type, title }) => (
											<SidebarMenuItem key={type}>
												<SidebarMenuButton
													onClick={() => handleOpenCreate(type)}
												>
													<span className="credential-provider-logo">
														<img
															src={PROVIDER_LOGOS[type]}
															alt=""
															className={type === 'anthropic_credential' || type === 'openai_credential' ? 'monochrome' : undefined}
														/>
													</span>
													<span className="min-w-0 flex-1 truncate">
														{title}
													</span>
													<Plus className="credential-provider-add" />
												</SidebarMenuButton>
											</SidebarMenuItem>
										))}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						</>
					)}
				</SidebarContent>
			</Sidebar>

			{/* Right detail */}
			<main className="flex-1 min-h-0 overflow-hidden rounded-[22px] bg-card shadow-panel">
				{selectedCredential ? (
					<DetailPanel
						credential={selectedCredential}
						schema={selectedSchema}
						onEdit={() => setEditOpen(true)}
						onDelete={() => setDeleteTarget(selectedCredential)}
					/>
				) : (
					<div className="flex h-full items-center justify-center">
						<Empty className="border-none">
							<EmptyHeader>
								<EmptyTitle>{t('credential.selectHint')}</EmptyTitle>
								<EmptyDescription>
									{t('credential.selectHintDescription')}
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					</div>
				)}
			</main>

			{/* Dialogs */}
			<CreateCredentialDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				defaultType={createDefaultType}
				allowedTypes={ADD_PROVIDER_TYPES}
				onCreated={() => refetch()}
			/>
			{selectedCredential && (
				<>
					<EditCredentialDialog
						open={editOpen}
						onOpenChange={setEditOpen}
						credential={selectedCredential}
						onUpdated={() => refetch()}
					/>
				</>
			)}
			<DeleteDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
				title={t('common.deleteTitle', {
					entity: t('credential.deleteEntity'),
					name: String(deleteTarget?.data.name ?? deleteTarget?.id ?? ''),
				})}
				description={t('common.deleteDescription')}
				confirmLabel={t('credential.deleteAction')}
				onConfirm={handleDelete}
			/>
			<Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open && !renaming) setRenameTarget(null); }}>
				<DialogContent className="credential-rename-dialog">
					<DialogHeader><DialogTitle>{t('credential.renameTitle')}</DialogTitle><DialogDescription>{t('credential.renameDescription')}</DialogDescription></DialogHeader>
					<form onSubmit={(event) => { event.preventDefault(); void handleRename(); }}>
						<label className="credential-rename-label" htmlFor="credential-rename-name">{t('credential.nameLabel')}</label>
						<input id="credential-rename-name" className="credential-rename-input" autoFocus maxLength={80} value={renameName} onChange={(event) => setRenameName(event.target.value)} />
						<DialogFooter><Button type="button" variant="ghost" disabled={renaming} onClick={() => setRenameTarget(null)}>{t('common.cancel')}</Button><Button type="submit" disabled={renaming || !renameName.trim()}>{renaming ? t('common.saving') : t('common.save')}</Button></DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
};
