import type { ContentBlock, TextBlock } from '@agentscope-ai/agentscope/message';
import { BrainCircuit, Check, ChevronDown, ChevronRight, Code2, FileText, FileUp, Film, FolderCode, Globe2, Image as ImageIcon, Link2, Loader2, MoreHorizontal, Paperclip, Play, Scissors, Send, Square, X } from 'lucide-react';
import mime from 'mime';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import type { ChatModelConfig, ModelCard } from '@/api';
import type { ScanEnvironmentInfo, ScanGeoJSON } from '@/api/missionScan';
import { useAvailableModels } from '@/hooks/useAvailableModels';

interface PendingAttachment {
	id: string;
	name: string;
	kind: 'file' | 'image' | 'link' | 'video' | 'code';
	status: 'processing' | 'ready' | 'error';
	block: ContentBlock | null;
	error?: string;
}

interface MissionComposerProps {
	homeMode?: boolean;
	canSend: boolean;
	isRunning: boolean;
	phase: string;
	modelType?: string;
	credentialId?: string;
	modelName?: string;
	placeholder?: string;
	quote?: string | null;
	onClearQuote?: () => void;
	modelParameters?: Record<string, unknown>;
	changingModel: boolean;
	onModelChange: (config: ChatModelConfig) => Promise<void>;
	onConfigureModels: () => void;
	onSend: (blocks: ContentBlock[]) => Promise<void>;
	onInterrupt: () => Promise<void>;
	onImportScanData?: (file: File, data: ScanGeoJSON) => Promise<void>;
	scanDataName?: string | null;
	scanDataBounds?: ScanEnvironmentInfo['bounds'];
}

const BUILTIN_MODELS = [
	{ name: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
	{ name: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
	{ name: 'qwen3.8-flash', label: 'Qwen3.8-Flash' },
	{ name: 'qwen3.8-max', label: 'Qwen3.8-Max' },
	{ name: 'qwen3.7-plus', label: 'Qwen3.7-Plus' },
] as const;

function supportsParameter(card: ModelCard, name: string): boolean {
	const properties = (card.parameter_schema as { properties?: Record<string, unknown> }).properties;
	return Boolean(properties && Object.hasOwn(properties, name));
}

function supportsFile(mimeType: string, accepted: string[]): boolean {
	return accepted.some((type) =>
		type === mimeType || type === '*/*' || (type.endsWith('/*') && mimeType.startsWith(type.slice(0, -1))),
	);
}

function readableDocument(mimeType: string): boolean {
	return mimeType === 'application/pdf' || mimeType === 'application/msword'
		|| mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function fileMediaType(file: File): string {
	if (/\.pdf$/i.test(file.name)) return 'application/pdf';
	if (/\.docx$/i.test(file.name)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	if (/\.doc$/i.test(file.name)) return 'application/msword';
	if (/\.(txt|md|markdown|csv|json|log|py|js|jsx|ts|tsx|yaml|yml|xml|html|css|go|rs|java|c|cc|cpp|h|hpp|sh|sql)$/i.test(file.name)) {
		return 'text/plain';
	}
	return file.type || mime.getType(file.name) || 'application/octet-stream';
}

async function fileToBlock(file: File): Promise<ContentBlock> {
	const now = new Date().toISOString();
	const mediaType = fileMediaType(file);
	if (mediaType === 'text/plain') {
		return {
			id: crypto.randomUUID(),
			type: 'text',
			text: `[File: ${file.name}]\n${await file.text()}`,
			created_at: now,
		};
	}
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
		reader.readAsDataURL(file);
	});
	return {
		id: crypto.randomUUID(),
		type: 'data',
		source: { type: 'base64', media_type: mediaType, data: dataUrl.slice(dataUrl.indexOf(',') + 1) },
		name: file.name,
		created_at: now,
	};
}

export function MissionComposer({
	homeMode = false,
	canSend,
	isRunning,
	phase,
	modelType,
	credentialId,
	modelName,
	placeholder,
	quote,
	onClearQuote,
	modelParameters,
	changingModel,
	onModelChange,
	onConfigureModels,
	onSend,
	onInterrupt,
	onImportScanData,
	scanDataName,
	scanDataBounds,
}: MissionComposerProps) {
	const { groups } = useAvailableModels();
	const modelChoices = Object.entries(groups).flatMap(([type, records]) =>
		records.flatMap(({ credential, models }) => models
			.filter((model) => model.type === 'chat_model' && model.status !== 'sunset')
			.map((model) => ({ type, credentialId: credential.id, model }))),
	);
	const featuredChoices = BUILTIN_MODELS.flatMap(({ name }) => {
		const choice = modelChoices.find((entry) => entry.type === 'dashscope_credential' && entry.model.name === name);
		return choice ? [choice] : [];
	});
	const moreChoices = modelChoices.filter((choice) => !featuredChoices.includes(choice));
	const selectedChoice = modelChoices.find((choice) =>
		choice.type === modelType && choice.credentialId === credentialId && choice.model.name === modelName,
	);
	const modelCard = selectedChoice?.model;
	const selectedBuiltin = modelType === 'dashscope_credential'
		? BUILTIN_MODELS.find((model) => model.name === modelName)
		: undefined;
	const selectedDirectDeepseek = modelType === 'deepseek_credential' && modelName === 'deepseek-flash';
	const thinkingEnabled = modelParameters?.thinking_enable === true;
	const searchEnabled = modelParameters?.search_enable === true;
	const modelButtonLabel = homeMode && modelName?.startsWith('deepseek')
		? `DS ${thinkingEnabled ? '深度' : '快速'}`
		: homeMode && modelName?.startsWith('qwen')
			? `Qwen ${thinkingEnabled ? '深度' : '快速'}`
			: selectedDirectDeepseek
		? `DS ${thinkingEnabled ? '深度' : '快速'}`
		: selectedBuiltin
			? `${selectedBuiltin.name.startsWith('deepseek') ? 'DS' : 'Qwen'} ${thinkingEnabled ? '深度' : '快速'}`
			: modelCard?.label ?? modelName ?? '选择模型';
	const [prompt, setPrompt] = useState('');
	const submittingRef = useRef(false);
	const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
	const [menuOpen, setMenuOpen] = useState(false);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);
	useEffect(() => {
		if (isRunning) setModelMenuOpen(false);
	}, [isRunning]);
	const [showMoreModels, setShowMoreModels] = useState(false);
	const [linkOpen, setLinkOpen] = useState(false);
	const [moreOpen, setMoreOpen] = useState(false);
	const [codeOpen, setCodeOpen] = useState(false);
	const [linkValue, setLinkValue] = useState('');
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const [importingScanData, setImportingScanData] = useState(false);
	const [pendingVideoPreview, setPendingVideoPreview] = useState<{ url: string; name: string; ownerDocument: Document } | null>(null);
	const [capturing, setCapturing] = useState(false);
	const promptId = useId();
	const areaRef = useRef<HTMLDivElement>(null);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const imageInputRef = useRef<HTMLInputElement>(null);
	const scanDataInputRef = useRef<HTMLInputElement>(null);
	const videoInputRef = useRef<HTMLInputElement>(null);
	const codeInputRef = useRef<HTMLInputElement>(null);
	const codeFolderInputRef = useRef<HTMLInputElement>(null);
	useEffect(() => { codeFolderInputRef.current?.setAttribute('webkitdirectory', ''); }, []);
	useEffect(() => { if (quote) promptRef.current?.focus(); }, [quote]);
	useEffect(() => {
		if (!pendingVideoPreview) return;
		const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setPendingVideoPreview(null); };
		pendingVideoPreview.ownerDocument.defaultView?.addEventListener('keydown', closeOnEscape);
		return () => pendingVideoPreview.ownerDocument.defaultView?.removeEventListener('keydown', closeOnEscape);
	}, [pendingVideoPreview]);


	useLayoutEffect(() => {
		const input = promptRef.current;
		if (!input) return;
		input.style.height = 'auto';
		input.style.height = `${Math.min(Math.max(input.scrollHeight, 34), 108)}px`;
	}, [prompt]);

	useEffect(() => {
		if (!menuOpen && !modelMenuOpen) return;
		const doc = areaRef.current?.ownerDocument;
		if (!doc) return;
		const closeOutside = (event: PointerEvent) => {
			if (!areaRef.current?.contains(event.target as Node)) {
				setMenuOpen(false);
				setModelMenuOpen(false);
				setLinkOpen(false);
				setMoreOpen(false);
				setCodeOpen(false);
			}
		};
		doc.addEventListener('pointerdown', closeOutside);
		return () => doc.removeEventListener('pointerdown', closeOutside);
	}, [menuOpen, modelMenuOpen]);

	const chooseModel = async (
		choice: typeof modelChoices[number],
		overrides: { thinking?: boolean; search?: boolean } = {},
		keepMenuOpen = false,
	) => {
		if (isRunning || changingModel) return;
		setAttachmentError(null);
		try {
			const parameters: Record<string, unknown> = {};
			if (supportsParameter(choice.model, 'thinking_enable')) {
				parameters.thinking_enable = overrides.thinking ?? true;
			}
			if (choice.type === 'dashscope_credential' && supportsParameter(choice.model, 'search_enable')) {
				parameters.search_enable = overrides.search ?? false;
			}
			await onModelChange({
				type: choice.type,
				credential_id: choice.credentialId,
				model: choice.model.name,
				parameters,
			});
			if (!keepMenuOpen) setModelMenuOpen(false);
		} catch (error) {
			setAttachmentError(error instanceof Error ? error.message : '切换模型失败');
		}
	};

	const addFiles = (files: File[], keepUnsupported = false) => {
		setAttachmentError(null);
		for (const file of files) {
			const mediaType = fileMediaType(file);
			if (mediaType.startsWith('video/') && file.size > 30 * 1024 * 1024) { setAttachmentError(`视频 ${file.name} 超过 30 MB，请压缩后上传。`); continue; }
			if (!keepUnsupported && modelCard && !readableDocument(mediaType) && !supportsFile(mediaType, modelCard.input_types)) {
				setAttachmentError(`当前模型 ${modelName} 不支持 ${mediaType} 文件，请切换支持该类型的模型。`);
				continue;
			}
			const id = crypto.randomUUID();
			const kind = mediaType.startsWith('image/') ? 'image' : mediaType.startsWith('video/') ? 'video' : /\.(py|js|jsx|ts|tsx|json|yaml|yml|html|css|md|go|rs|java|cpp|c|h)$/i.test(file.name) ? 'code' : 'file';
			setAttachments((items) => [...items, { id, name: file.name, kind, status: 'processing', block: null }]);
			const namedFile = file.webkitRelativePath ? new File([file], file.webkitRelativePath, { type: file.type }) : file;
			void fileToBlock(namedFile)
				.then((block) => setAttachments((items) => items.map((item) =>
					item.id === id ? { ...item, status: 'ready', block } : item,
				)))
				.catch((error: unknown) => setAttachments((items) => items.map((item) =>
					item.id === id ? { ...item, status: 'error', error: error instanceof Error ? error.message : '读取失败' } : item,
				)));
		}
	};

	const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
		addFiles(Array.from(event.target.files ?? []));
		event.target.value = '';
	};
	const selectScanData = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (!file) return;
		if (file.size > 20 * 1024 * 1024) { setAttachmentError('GeoJSON 文件不得超过 20 MB。'); return; }
		if (!onImportScanData) { setAttachmentError('当前页面暂不支持导入海域数据。'); return; }
		setImportingScanData(true);
		setAttachmentError(null);
		try {
			const data: unknown = JSON.parse(await file.text());
			if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('GeoJSON 顶层必须是对象');
			await onImportScanData(file, data as ScanGeoJSON);
		} catch (error) {
			setAttachmentError(error instanceof Error ? error.message : '海域数据导入失败');
		} finally {
			setImportingScanData(false);
		}
	};
	const selectCodeFolder = (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []).filter((file) => /\.(txt|md|markdown|csv|json|log|py|js|jsx|ts|tsx|yaml|yml|xml|html|css|go|rs|java|c|cc|cpp|h|hpp|sh|sql)$/i.test(file.name));
		if (files.length) addFiles(files);
		else setAttachmentError('所选文件夹中没有可上传的文本或代码文件。');
		event.target.value = '';
	};

	const captureScreenshot = async () => {
		if (!navigator.mediaDevices?.getDisplayMedia || capturing) {
			if (!capturing) setAttachmentError('当前浏览器无法调用屏幕截图，请在 localhost 或安全连接中打开页面。');
			return;
		}
		setCapturing(true);
		setAttachmentError(null);
		let stream: MediaStream | null = null;
		try {
			stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
			const video = document.createElement('video');
			video.muted = true;
			video.playsInline = true;
			const metadataReady = new Promise<void>((resolve, reject) => {
				video.onloadedmetadata = () => resolve();
				video.onerror = () => reject(new Error('无法读取截图画面'));
			});
			video.srcObject = stream;
			await metadataReady;
			await video.play();
			await new Promise<void>((resolve) => {
				let settled = false;
				const finish = () => {
					if (settled) return;
					settled = true;
					resolve();
				};
				window.setTimeout(finish, 500);
				if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(finish);
			});
			const canvas = document.createElement('canvas');
			const scale = Math.min(1, 1920 / video.videoWidth, 1080 / video.videoHeight);
			canvas.width = Math.round(video.videoWidth * scale);
			canvas.height = Math.round(video.videoHeight * scale);
			if (!canvas.width || !canvas.height) throw new Error('截图画面为空');
			const context = canvas.getContext('2d');
			if (!context) throw new Error('浏览器无法生成截图');
			context.drawImage(video, 0, 0, canvas.width, canvas.height);
			const blob = await new Promise<Blob>((resolve, reject) =>
				canvas.toBlob((result) => result ? resolve(result) : reject(new Error('截图保存失败')), 'image/png'),
			);
			addFiles([new File([blob], `截图-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, { type: 'image/png' })], true);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'NotAllowedError') {
				setAttachmentError('截图已取消，或浏览器未允许共享屏幕。请重新点击截图并选择屏幕、窗口或标签页。');
				return;
			}
			setAttachmentError(error instanceof Error ? error.message : '快捷截图失败');
		} finally {
			stream?.getTracks().forEach((track) => track.stop());
			setCapturing(false);
		}
	};

	const addLink = () => {
		try {
			const url = new URL(linkValue.trim());
			if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('请输入 http 或 https 链接');
			const now = new Date().toISOString();
			const mediaType = mime.getType(url.pathname);
			const isRemoteFile = Boolean(mediaType && mediaType !== 'text/plain' && mediaType !== 'text/html');
			if (isRemoteFile && mediaType && modelCard && !supportsFile(mediaType, modelCard.input_types)) {
				throw new Error(`当前模型 ${modelName} 不支持 ${mediaType} 链接，请切换模型。`);
			}
			const block: ContentBlock = isRemoteFile && mediaType
				? {
					id: crypto.randomUUID(), type: 'data',
					source: { type: 'url', url: url.href, media_type: mediaType },
					name: url.pathname.split('/').pop() || url.hostname,
					created_at: now,
				}
				: {
					id: crypto.randomUUID(), type: 'text', text: `链接：${url.href}`,
					created_at: now, finished_at: now,
				} satisfies TextBlock;
			setAttachments((items) => [...items, {
				id: crypto.randomUUID(), name: url.href,
				kind: mediaType?.startsWith('image/') ? 'image' : 'link', status: 'ready', block,
			}]);
			setLinkValue('');
			setLinkOpen(false);
			setMenuOpen(false);
			setAttachmentError(null);
		} catch (error) {
			setAttachmentError(error instanceof Error ? error.message : '链接格式不正确');
		}
	};

	const hasProcessing = attachments.some((item) => item.status === 'processing');
	const readyAttachments = attachments.filter((item) => item.status === 'ready' && item.block);
	const unsupportedAttachment = readyAttachments.find((item) => item.block?.type === 'data' && modelCard && !readableDocument(item.block.source.media_type) && !supportsFile(item.block.source.media_type, modelCard.input_types));
	const canSubmit = canSend && !hasProcessing && !unsupportedAttachment && (Boolean(prompt.trim()) || Boolean(quote) || readyAttachments.length > 0);

	const submitDraft = async () => {
		if (!canSubmit || submittingRef.current) return;
		submittingRef.current = true;
		const blocks: ContentBlock[] = [];
		const text = [quote ? quote.split('\n').map((line) => `> ${line}`).join('\n') : '', prompt.trim()].filter(Boolean).join('\n\n');
		if (text) {
			const now = new Date().toISOString();
			blocks.push({ id: crypto.randomUUID(), type: 'text', text, created_at: now, finished_at: now });
		}
		for (const item of readyAttachments) if (item.block) blocks.push(item.block);
		setPrompt('');
		onClearQuote?.();
		setAttachments([]);
		setPendingVideoPreview(null);
		setAttachmentError(null);
		try {
			await onSend(blocks);
		} catch (error) {
			setPrompt((current) => current ? `${prompt}\n${current}` : prompt);
			setAttachmentError(error instanceof Error ? error.message : '发送失败，请重试');
		} finally {
			submittingRef.current = false;
		}
	};
	const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
		event.preventDefault();
		void submitDraft();
	};
	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		void submitDraft();
	};

	return (
		<div className="mission-composer-area" ref={areaRef}>
			{quote && <div className="mission-composer-quote"><span>引用：{quote}</span><button type="button" aria-label="取消引用" onClick={onClearQuote}><X size={15} /></button></div>}
			<input ref={fileInputRef} className="sr-only" type="file" multiple onChange={selectFiles} aria-label="选择文件" />
			<input ref={imageInputRef} className="sr-only" type="file" accept="image/*" multiple onChange={selectFiles} aria-label="选择图片" />
			<input ref={scanDataInputRef} className="sr-only" type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(event) => void selectScanData(event)} aria-label="选择海域数据" />
			<input ref={videoInputRef} className="sr-only" type="file" accept="video/*" multiple onChange={selectFiles} aria-label="选择视频" />
			<input ref={codeInputRef} className="sr-only" type="file" accept=".txt,.md,.json,.py,.js,.jsx,.ts,.tsx,.yaml,.yml,.xml,.html,.css,.go,.rs,.java,.c,.cc,.cpp,.h,.hpp,.sh,.sql" multiple onChange={selectFiles} aria-label="选择代码文件" />
			<input ref={codeFolderInputRef} className="sr-only" type="file" multiple onChange={selectCodeFolder} aria-label="选择代码文件夹" />
			{(scanDataName || importingScanData) && <div className="mission-scan-data-status" role="status"><Globe2 size={15} /><span>{importingScanData ? '正在导入海域数据…' : `已导入海域数据：${scanDataName}`}{scanDataBounds && <small>经度 {scanDataBounds.west.toFixed(4)}～{scanDataBounds.east.toFixed(4)}°，纬度 {scanDataBounds.south.toFixed(4)}～{scanDataBounds.north.toFixed(4)}°</small>}</span></div>}
			{attachments.length > 0 && (
				<div className="mission-attachment-list" aria-label="待发送附件">
					{attachments.map((item) => (
						<div className={`mission-attachment ${item.kind} ${item.status}`} key={item.id} data-tooltip={item.error ?? item.name}>
							{item.status === 'processing' ? <Loader2 className="spinning" size={17} /> : item.kind === 'image' && item.block?.type === 'data' ? (
								<img className="mission-attachment-preview" src={item.block.source.type === 'url' ? item.block.source.url : `data:${item.block.source.media_type};base64,${item.block.source.data}`} alt="" />
							) : item.kind === 'image' ? <ImageIcon size={17} /> : item.kind === 'video' ? <Film size={17} /> : item.kind === 'code' ? <Code2 size={17} /> : item.kind === 'link' ? <Link2 size={17} /> : <FileText size={17} />}
							{item.kind === 'video' && item.block?.type === 'data' ? <button className="mission-attachment-video-open" type="button" onClick={(event) => { const source = item.block?.type === 'data' ? item.block.source : null; if (!source) return; setPendingVideoPreview({ url: source.type === 'url' ? source.url : `data:${source.media_type};base64,${source.data}`, name: item.name, ownerDocument: event.currentTarget.ownerDocument }); }} aria-label={`预览视频：${item.name}`}><Play size={13} fill="currentColor" />{item.name}</button> : <span>{item.name}</span>}
							<button type="button" aria-label={`移除 ${item.name}`} onClick={() => setAttachments((items) => items.filter((entry) => entry.id !== item.id))}><X size={15} /></button>
						</div>
					))}
				</div>
			)}
			{attachmentError && <div className="mission-attachment-error" role="alert">{attachmentError}</div>}
			{unsupportedAttachment && <div className="mission-attachment-error" role="status">当前模型 {modelName} 不支持该附件。附件已保留，请在模型菜单中选择支持该格式的模型后发送。</div>}
			<form className="composer" onSubmit={(event) => void handleSubmit(event)}>
				<label className="sr-only" htmlFor={promptId}>任务需求</label>
				<textarea ref={promptRef} id={promptId} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handlePromptKeyDown} onPaste={(event) => { const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/')); if (images.length) { event.preventDefault(); addFiles(images, true); } }} placeholder={placeholder ?? (modelName ? '描述任务或添加附件…' : '请先选择 Agent、历史会话并配置模型')} rows={1} />
				<div className="mission-composer-toolbar">
					<div className="mission-model-picker">
						<button className="mission-inline-model-select" type="button" aria-label="选择模型与功能" aria-expanded={modelMenuOpen} onClick={() => { setModelMenuOpen((value) => !value); setMenuOpen(false); }} disabled={isRunning || changingModel}>
							<Globe2 size={14} /><span>{modelButtonLabel}</span><ChevronDown size={13} />
						</button>
						{modelMenuOpen && (
							<div className="mission-model-menu" role="menu" aria-label="内置模型与功能">
								<div className="mission-model-menu-row">
									<span><Globe2 size={16} /> 联网搜索</span>
									<button className={`mission-model-switch ${searchEnabled ? 'active' : ''}`} type="button" role="switch" aria-checked={searchEnabled} aria-label="联网搜索" disabled={!selectedChoice || selectedChoice.type !== 'dashscope_credential' || !supportsParameter(selectedChoice.model, 'search_enable')} onClick={() => { if (selectedChoice) void chooseModel(selectedChoice, { thinking: thinkingEnabled, search: !searchEnabled }, true); }}><span /></button>
								</div>
								<div className="mission-model-menu-row">
									<span><BrainCircuit size={16} /> 思考模式</span>
									<div className="mission-thinking-choice" role="group" aria-label="思考模式">
										<button type="button" className={!thinkingEnabled ? 'active' : ''} disabled={!selectedChoice || !supportsParameter(selectedChoice.model, 'thinking_enable')} onClick={() => { if (selectedChoice) void chooseModel(selectedChoice, { thinking: false, search: searchEnabled }, true); }}>快速</button>
										<button type="button" className={thinkingEnabled ? 'active' : ''} disabled={!selectedChoice || !supportsParameter(selectedChoice.model, 'thinking_enable')} onClick={() => { if (selectedChoice) void chooseModel(selectedChoice, { thinking: true, search: searchEnabled }, true); }}>深度</button>
									</div>
								</div>
								<div className="mission-model-section-label">{showMoreModels ? '更多模型' : '内置模型'}</div>
								<div className="mission-model-options">
									{(showMoreModels ? moreChoices : featuredChoices).map((choice) => (
										<button key={`${choice.type}:${choice.credentialId}:${choice.model.name}`} className="mission-model-option" type="button" role="menuitemradio" aria-checked={selectedChoice === choice} onClick={() => void chooseModel(choice)} title={`${choice.type} · ${choice.model.name}`}>
											<span className={`mission-model-provider ${choice.model.name.startsWith('qwen') ? 'qwen' : 'deepseek'}`}>{choice.model.name.slice(0, 1).toUpperCase()}</span><span>{choice.model.label}</span>{selectedChoice === choice && <Check size={16} />}
										</button>
									))}
								</div>
								{moreChoices.length > 0 && <button className="mission-model-more" type="button" aria-expanded={showMoreModels} onClick={() => setShowMoreModels((value) => !value)}><ChevronRight size={14} className={showMoreModels ? 'expanded' : ''} />{showMoreModels ? '返回内置模型' : '更多模型'}</button>}
								<button className="mission-model-configure" type="button" onClick={() => { setModelMenuOpen(false); onConfigureModels(); }}>＋ 设置凭证与模型</button>
								{modelChoices.length === 0 && <p className="mission-model-hint">请先配置模型 API 凭证</p>}
							</div>
						)}
					</div>
					<div className="mission-composer-actions">
						<div className="mission-attachment-picker">
							<button className="mission-attach-trigger" type="button" aria-label="添加附件" aria-expanded={menuOpen} aria-haspopup="menu" data-tooltip="添加附件" onClick={() => { setMenuOpen((value) => !value); setLinkOpen(false); setMoreOpen(false); setCodeOpen(false); }} disabled={!modelName || isRunning}>
								<Paperclip size={19} />
							</button>
							{menuOpen && <div className="mission-attachment-menu" role="menu" aria-label="添加内容">
								<button type="button" role="menuitem" onClick={() => { fileInputRef.current?.click(); setMenuOpen(false); }}><FileUp size={18} /><span><strong>上传文件</strong><small>文档、文本等文件</small></span></button>
								<button type="button" role="menuitem" onClick={() => { imageInputRef.current?.click(); setMenuOpen(false); }}><ImageIcon size={18} /><span><strong>上传图片</strong><small>选择一张或多张图片</small></span></button>
								<button type="button" role="menuitem" onClick={() => { scanDataInputRef.current?.click(); setMenuOpen(false); }} disabled={importingScanData}><Globe2 size={18} /><span><strong>上传海域数据</strong><small>GeoJSON 搜索区域与障碍物</small></span></button>
								<button type="button" role="menuitem" aria-expanded={moreOpen} onClick={() => { setMoreOpen((value) => !value); setLinkOpen(false); setCodeOpen(false); }}><MoreHorizontal size={18} /><span><strong>更多</strong></span><ChevronRight className={moreOpen ? 'mission-menu-chevron open' : 'mission-menu-chevron'} size={15} /></button>
								{moreOpen && <div className="mission-attachment-submenu">
									<button type="button" role="menuitem" onClick={() => { setLinkOpen((value) => !value); setCodeOpen(false); }}><Link2 size={18} /><span>添加链接</span></button>
									{linkOpen && <div className="mission-link-form"><input type="url" autoFocus placeholder="https://example.com" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addLink(); } }} aria-label="链接地址" /><button type="button" onClick={addLink}>添加</button></div>}
									<button type="button" role="menuitem" onClick={() => { videoInputRef.current?.click(); setMenuOpen(false); }}><Film size={18} /><span>上传视频</span></button>
									<button type="button" role="menuitem" aria-expanded={codeOpen} onClick={() => { setCodeOpen((value) => !value); setLinkOpen(false); }}><Code2 size={18} /><span>上传代码</span><ChevronRight className={codeOpen ? 'mission-menu-chevron open' : 'mission-menu-chevron'} size={15} /></button>
									{codeOpen && <div className="mission-attachment-code-options">
										<button type="button" role="menuitem" onClick={() => { codeInputRef.current?.click(); setMenuOpen(false); }}><Code2 size={16} />代码文件</button>
										<button type="button" role="menuitem" onClick={() => { codeFolderInputRef.current?.click(); setMenuOpen(false); }}><FolderCode size={16} />代码文件夹</button>
									</div>}
								</div>}
							</div>}
						</div>
						<button className="mission-screenshot-trigger" type="button" aria-label="快捷截图" data-tooltip="快捷截图" onClick={() => void captureScreenshot()} disabled={isRunning || capturing}>
							{capturing ? <Loader2 className="spinning" size={18} /> : <Scissors size={20} />}
						</button>
						<button className="send-button" type={isRunning ? 'button' : 'submit'} onClick={isRunning ? () => void onInterrupt() : undefined} disabled={isRunning ? phase === 'interrupting' : !canSubmit} aria-label={isRunning ? '停止回复' : '提交任务'}>
							{isRunning ? <Square className="icon" /> : <Send className="icon" />}
						</button>
					</div>
				</div>
			</form>
			{pendingVideoPreview && createPortal(<div className="mission-image-viewer-backdrop mission-video-viewer" role="dialog" aria-modal="true" aria-label={`预览视频：${pendingVideoPreview.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingVideoPreview(null); }}><button className="mission-image-viewer-close" type="button" aria-label="关闭视频预览" onClick={() => setPendingVideoPreview(null)}><X size={22} /></button><div className="mission-video-viewer-content"><video src={pendingVideoPreview.url} controls autoPlay playsInline /><span>{pendingVideoPreview.name}</span></div></div>, pendingVideoPreview.ownerDocument.body)}
		</div>
	);
}
