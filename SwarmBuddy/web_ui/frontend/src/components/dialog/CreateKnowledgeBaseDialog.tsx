import { Loader2, PlusCircle, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { useKbEmbeddingModels } from '@/hooks/useKbEmbeddingModels';
import { useKnowledgeBases } from '@/hooks/useKnowledgeBases';
import { useTranslation } from '@/i18n/useI18n.ts';
import { KNOWLEDGE_COVERS, localCoverDataUrl } from '@/pages/knowledge/knowledgeCovers';
import { qwen3VlEmbeddingConfig } from '@/pages/knowledge/knowledgeEmbedding';

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated?: (knowledgeBaseId: string) => void;
	onAddCredential?: () => void;
	credentialRefetchTrigger?: number;
}

export function CreateKnowledgeBaseDialog({ open, onOpenChange, onCreated, onAddCredential, credentialRefetchTrigger }: Props) {
	const { t } = useTranslation();
	const { create } = useKnowledgeBases();
	const { providers, policy, loading, error: modelsError } = useKbEmbeddingModels(credentialRefetchTrigger);
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [coverKey, setCoverKey] = useState<string | null>(null);
	const [coverFileName, setCoverFileName] = useState<string | null>(null);
	const [coverProcessing, setCoverProcessing] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const coverRequest = useRef(0);

	const defaultEmbedding = useMemo(() => qwen3VlEmbeddingConfig(providers, policy), [providers, policy]);

	useEffect(() => {
		if (open) return;
		coverRequest.current += 1;
		setName('');
		setDescription('');
		setCoverKey(null);
		setCoverFileName(null);
		setCoverProcessing(false);
		setError(null);
		setSubmitting(false);
	}, [open]);

	const handleSubmit = async () => {
		if (!name.trim()) { setError('请输入知识库名称。'); return; }
		if (!defaultEmbedding) { setError('请先在凭证中配置 DashScope 的 Qwen3 VL Embedding 模型。'); return; }
		setError(null);
		setSubmitting(true);
		try {
			const id = await create({ name: name.trim(), description: description.trim(), cover_key: coverKey, embedding_model_config: defaultEmbedding });
			onCreated?.(id);
			onOpenChange(false);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : '创建知识库失败，请重试。');
		} finally {
			setSubmitting(false);
		}
	};

	const uploadCover = async (file: File | undefined) => {
		if (!file) return;
		const request = ++coverRequest.current;
		setCoverProcessing(true);
		try {
			const dataUrl = await localCoverDataUrl(file);
			if (request !== coverRequest.current) return;
			setCoverKey(dataUrl);
			setCoverFileName(file.name);
			setError(null);
		} catch (caught) {
			if (request === coverRequest.current) setError(caught instanceof Error ? caught.message : '封面上传失败。');
		} finally {
			if (request === coverRequest.current) setCoverProcessing(false);
		}
	};

	return <Dialog open={open} onOpenChange={onOpenChange}>
		<DialogContent className="!w-[500px] !max-w-[500px] max-h-[calc(100dvh-2rem)] overflow-y-auto">
			<DialogHeader><DialogTitle>{t('dialog-knowledge-base-create.title')}</DialogTitle></DialogHeader>
			<FieldGroup>
				<Field><FieldLabel>{t('dialog-knowledge-base-create.name.label')}</FieldLabel><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t('dialog-knowledge-base-create.name.placeholder')} disabled={submitting} /></Field>
				<Field><FieldLabel>{t('dialog-knowledge-base-create.descriptionField.label')}</FieldLabel><Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('dialog-knowledge-base-create.descriptionField.placeholder')} disabled={submitting} rows={3} /></Field>
				<Field><div className="flex items-center justify-between"><FieldLabel>封面（可选）</FieldLabel>{coverKey && <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setCoverKey(null); setCoverFileName(null); }} disabled={submitting || coverProcessing}>使用文档首页</button>}</div><div className="grid grid-cols-3 gap-2" role="group" aria-label="选择知识库封面"><label className={`flex h-[94px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed text-xs transition-colors ${coverFileName ? 'border-primary ring-2 ring-primary/60' : 'border-border hover:border-primary/60'}`}><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={submitting || coverProcessing} onChange={(event) => { void uploadCover(event.target.files?.[0]); event.target.value = ''; }} />{coverFileName && coverKey ? <><img src={coverKey} alt="已上传的封面" className="h-[70px] w-full object-cover" /><span className="w-full truncate px-1 text-center">{coverFileName}</span></> : <>{coverProcessing ? <Loader2 className="mb-1 size-5 animate-spin" /> : <Upload className="mb-1 size-5" />}{coverProcessing ? '处理中' : '本地上传'}</>}</label>{KNOWLEDGE_COVERS.map((cover) => <button key={cover.key} type="button" aria-label={`选择${cover.label}封面`} aria-pressed={coverKey === cover.key} className={`h-[94px] overflow-hidden rounded-lg border text-left transition-colors ${coverKey === cover.key ? 'border-primary ring-2 ring-primary/60' : 'border-border hover:border-primary/60'}`} onClick={() => { setCoverKey(cover.key); setCoverFileName(null); }} disabled={submitting || coverProcessing}><img src={cover.src} alt="" className="h-[70px] w-full object-cover" /><span className="block truncate px-1 text-center text-[11px]">{cover.label}</span></button>)}</div><p className="text-xs text-muted-foreground">未选择封面时，首次上传文档后会使用其第一页。</p></Field>
				{error && <p className="text-destructive text-sm" role="alert">{error}</p>}
				{modelsError && <p className="text-destructive text-sm" role="alert">获取模型失败：{modelsError.message}</p>}
				{!loading && !defaultEmbedding && !modelsError && <p className="text-muted-foreground text-sm">需要 DashScope 的 Qwen3 VL Embedding 模型。{onAddCredential && <button className="ml-2 text-primary underline" type="button" onClick={onAddCredential}>添加凭证</button>}</p>}
			</FieldGroup>
			<DialogFooter>
				<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>{t('common.cancel')}</Button>
				<Button onClick={() => void handleSubmit()} disabled={submitting || coverProcessing || loading || !defaultEmbedding}>{submitting ? <Loader2 className="size-3.5 animate-spin" /> : <PlusCircle className="size-3.5" />}{submitting ? t('common.creating') : t('common.create')}</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>;
}
