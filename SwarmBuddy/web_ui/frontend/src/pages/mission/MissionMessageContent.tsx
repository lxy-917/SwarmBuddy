import type { ContentBlock } from '@agentscope-ai/agentscope/message';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { ExternalLink, LoaderCircle, Play, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { ComponentProps } from 'react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ThemeInput } from 'streamdown';

import { formatMissionMarkdown } from './missionMarkdown';
import { formatMissionDuration } from './missionTime';
import { Markdown } from '@/components/markdown';

const markdownControls = { code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: true }, mermaid: { copy: true, download: false } } as const;
const markdownTranslations = { copyCode: '复制代码', copied: '已复制', copyTable: '复制表格' };
const markdownShikiTheme: [ThemeInput, ThemeInput] = ['github-light', 'github-dark'];
const missionMarkdownPlugins = { code, math: createMathPlugin({ singleDollarTextMath: true }), cjk, mermaid };
const missionMarkdownComponents = { a: MissionLink };
const linkSafetyDisabled = { enabled: false };

function MissionLink({ href, children, title }: ComponentProps<'a'>) {
	if (!href) return <span>{children}</span>;
	let url: URL;
	try {
		url = new URL(href, window.location.href);
	} catch {
		return <span>{children}</span>;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return <span>{children}</span>;
	const host = url.hostname.replace(/^www\./, '');
	const domain = host.split('.').at(-2) ?? host;
	const initials = domain.split('-').map((part) => part[0]?.toUpperCase()).join('').slice(0, 2) || domain.slice(0, 2).toUpperCase();
	return <span className="mission-link-wrap">
		<a className="mission-answer-link" href={url.href} target="_blank" rel="noopener noreferrer" title={title ?? url.href}>{children}</a>
		<span className="mission-link-preview">
			<span className="mission-link-preview-card">
				<span className="mission-link-favicon" aria-hidden="true">{initials}</span>
				<span className="mission-link-host" title={host}>{host}</span>
				<a className="mission-link-open" href={url.href} target="_blank" rel="noopener noreferrer" aria-label={`打开 ${host}`}>打开 <ExternalLink size={13} aria-hidden="true" /></a>
			</span>
		</span>
	</span>;
}

// 上游可能一次送来一大段文本；按时间逐步显示，避免整段突然跳出来。
function usePacedText(source: string, pace: boolean): number {
	const [visibleLength, setVisibleLength] = useState(() => pace ? Math.min(source.length, 1) : source.length);
	const visibleRef = useRef(visibleLength);
	const sourceRef = useRef(source);
	const previousSourceRef = useRef(source);
	const frameRef = useRef<number | null>(null);
	const lastFrameRef = useRef(0);
	const lastPaintRef = useRef(0);
	const creditRef = useRef(0);

	useLayoutEffect(() => {
		sourceRef.current = source;
		if (!pace) {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
			visibleRef.current = source.length;
			setVisibleLength(source.length);
			previousSourceRef.current = source;
			return;
		}
		// 正文已到达时先显示首字，不让用户看到可复制却空白的回复。
		if (visibleRef.current === 0 && source.length > 0) {
			visibleRef.current = 1;
			setVisibleLength(visibleRef.current);
		}
		if (!source.startsWith(previousSourceRef.current)) {
			visibleRef.current = Math.min(source.length, 1);
			setVisibleLength(visibleRef.current);
		}
		previousSourceRef.current = source;
		if (frameRef.current !== null || visibleRef.current >= source.length) return;
		const tick = (now: number) => {
			const target = sourceRef.current;
			const backlog = target.length - visibleRef.current;
			if (backlog <= 0) { frameRef.current = null; lastFrameRef.current = 0; creditRef.current = 0; return; }
			const elapsed = lastFrameRef.current ? Math.min(now - lastFrameRef.current, 100) : 16;
			lastFrameRef.current = now;
			// 优先逐字显示；长回复积压时最多每帧补两个字，保持速度和页面响应。
			const rate = Math.min(140, Math.max(70, backlog / 8));
			creditRef.current += elapsed * rate / 1000;
			if (now - lastPaintRef.current >= 16) {
				let next = Math.min(target.length, visibleRef.current + Math.max(1, Math.min(2, Math.floor(creditRef.current))));
				if (next < target.length && target.charCodeAt(next - 1) >= 0xd800 && target.charCodeAt(next - 1) <= 0xdbff) next += 1;
				creditRef.current = Math.max(0, creditRef.current - (next - visibleRef.current));
				visibleRef.current = next;
				lastPaintRef.current = now;
				setVisibleLength(next);
			}
			frameRef.current = requestAnimationFrame(tick);
		};
		frameRef.current = requestAnimationFrame(tick);
	}, [source, pace]);
	useEffect(() => () => {
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
		lastFrameRef.current = 0;
	}, []);
	return visibleLength;
}

const RenderedMissionMarkdown = memo(function RenderedMissionMarkdown({ text, mode, attachmentsFirst }: { text: string; mode: 'static' | 'streaming'; attachmentsFirst: boolean }) {
	return <Markdown mode={mode} lineNumbers={false} controls={markdownControls} translations={markdownTranslations} plugins={attachmentsFirst ? undefined : missionMarkdownPlugins} shikiTheme={markdownShikiTheme} components={attachmentsFirst ? undefined : missionMarkdownComponents} linkSafety={attachmentsFirst ? undefined : linkSafetyDisabled}>{text}</Markdown>;
});

const MissionTextBlock = memo(function MissionTextBlock({ blockKey, source, streaming, attachmentsFirst, pace, onRevealChange }: { blockKey: string; source: string; streaming: boolean; attachmentsFirst: boolean; pace: boolean; onRevealChange?: (blockKey: string, revealing: boolean) => void }) {
	const visibleLength = usePacedText(source, pace);
	const revealing = visibleLength < source.length;
	useEffect(() => {
		if (!onRevealChange) return;
		onRevealChange(blockKey, revealing);
		return () => onRevealChange(blockKey, false);
	}, [blockKey, revealing, onRevealChange]);
	const text = source.slice(0, visibleLength);
	return <div className="mission-markdown-block"><RenderedMissionMarkdown text={attachmentsFirst ? text : formatMissionMarkdown(text)} mode={streaming || revealing ? 'streaming' : 'static'} attachmentsFirst={attachmentsFirst} /></div>;
});

function MissionThinkingSection({ block, streaming, replyFinishedAt }: { block: Extract<ContentBlock, { type: 'thinking' }>; streaming: boolean; replyFinishedAt?: string | null }) {
	const [now, setNow] = useState(() => Date.now());
	const [expanded, setExpanded] = useState(false);
	const finishedAt = block.finished_at ?? replyFinishedAt;
	useEffect(() => {
		if (!streaming || finishedAt) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [streaming, finishedAt]);
	const duration = finishedAt || streaming ? formatMissionDuration(block.created_at, finishedAt, now) : null;
	const label = finishedAt ? `思考了 ${duration ?? '一段时间'}` : streaming ? `正在思考${duration ? ` · ${duration}` : ''}` : '思考过程';
	return <details className="mission-thinking" onToggle={(event) => setExpanded(event.currentTarget.open)}><summary>{streaming && !finishedAt && <LoaderCircle className="mission-thinking-spinner" size={15} aria-hidden="true" />}<span>{label}</span><span className="mission-thinking-expand">展开内容</span></summary>{expanded && <RenderedMissionMarkdown text={formatMissionMarkdown(block.thinking)} mode={streaming ? 'streaming' : 'static'} attachmentsFirst={false} />}</details>;
}

export const MissionMessageContent = memo(function MissionMessageContent({ content, fallback, attachmentsFirst = false, streaming = false, pace = streaming, replyFinishedAt, revealKeyPrefix, onRevealChange }: { content: ContentBlock[]; fallback: string; attachmentsFirst?: boolean; streaming?: boolean; pace?: boolean; replyFinishedAt?: string | null; revealKeyPrefix?: string; onRevealChange?: (blockKey: string, revealing: boolean) => void }) {
	const [preview, setPreview] = useState<{ url: string; name: string; ownerDocument: Document } | null>(null);
	const [videoPreview, setVideoPreview] = useState<{ url: string; name: string; ownerDocument: Document } | null>(null);
	const [zoom, setZoom] = useState(1);
	const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!preview) return;
		closeButtonRef.current?.focus();
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setPreview(null);
		};
		const previewWindow = preview.ownerDocument.defaultView;
		previewWindow?.addEventListener('keydown', handleKeyDown);
		return () => previewWindow?.removeEventListener('keydown', handleKeyDown);
	}, [preview]);
	useEffect(() => {
		if (!videoPreview) return;
		closeButtonRef.current?.focus();
		const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setVideoPreview(null); };
		const previewWindow = videoPreview.ownerDocument.defaultView;
		previewWindow?.addEventListener('keydown', handleKeyDown);
		return () => previewWindow?.removeEventListener('keydown', handleKeyDown);
	}, [videoPreview]);
	const visible = content.filter((block) => block.type === 'text' || block.type === 'thinking' || block.type === 'data');
	if (visible.length === 0) return <span>{fallback}</span>;
	const attachments = attachmentsFirst ? visible.filter((block) => block.type === 'data') : [];
	const remaining = attachmentsFirst ? visible.filter((block) => block.type !== 'data') : visible;
	const renderBlock = (block: ContentBlock) => {
		if (block.type === 'text') return <MissionTextBlock key={block.id} blockKey={`${revealKeyPrefix ?? ''}:${block.id}`} source={block.text} streaming={streaming} attachmentsFirst={attachmentsFirst} pace={pace} onRevealChange={onRevealChange} />;
		if (block.type === 'thinking') return <MissionThinkingSection block={block} streaming={streaming} replyFinishedAt={replyFinishedAt} key={block.id} />;
		if (block.type !== 'data') return null;
		const source = block.source;
		const name = block.name || '附件';
		const url = source.type === 'base64' ? `data:${source.media_type};base64,${source.data}` : source.url;
		return source.media_type.startsWith('image/')
			? <button className="mission-message-image-button" type="button" key={block.id} aria-label={`放大查看${name}`} onClick={(event) => { setPreview({ url, name, ownerDocument: event.currentTarget.ownerDocument }); setZoom(1); setImageSize({ width: 0, height: 0 }); }}><img className="mission-message-image" src={url} alt={name} /></button>
			: source.media_type.startsWith('video/')
			? <button className="mission-message-video-button" type="button" key={block.id} aria-label={`播放视频：${name}`} onClick={(event) => setVideoPreview({ url, name, ownerDocument: event.currentTarget.ownerDocument })}><span className="mission-message-video-thumb"><video src={url} preload="metadata" muted playsInline /><Play size={25} fill="currentColor" /></span><span className="mission-message-video-name">{name}</span></button>
			: <span className="mission-message-file" key={block.id}>附件：{name}</span>;
	};
	const previewWindow = preview?.ownerDocument.defaultView;
	const fit = imageSize.width && imageSize.height && previewWindow
		? Math.min(1, previewWindow.innerWidth * 0.84 / imageSize.width, previewWindow.innerHeight * 0.76 / imageSize.height)
		: 1;
	return <><div className={`mission-message-content${attachmentsFirst ? ' mission-user-message-content' : ''}`}>
		{attachments.length > 0 && <div className="mission-message-attachments">{attachments.map(renderBlock)}</div>}
		{attachmentsFirst ? remaining.length > 0 && <div className="mission-message-body">{remaining.map(renderBlock)}</div> : remaining.map(renderBlock)}
	</div>{preview && createPortal(
		<div className="mission-image-viewer-backdrop" role="dialog" aria-modal="true" aria-label={`查看图片：${preview.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
				<div className="mission-image-viewer-toolbar" role="toolbar" aria-label="图片缩放">
					<button type="button" aria-label="缩小图片" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}><ZoomOut size={18} /></button>
					<button type="button" aria-label="放大图片" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + 0.25))}><ZoomIn size={18} /></button>
				</div>
				<button className="mission-image-viewer-close" type="button" aria-label="关闭图片预览" ref={closeButtonRef} onClick={() => setPreview(null)}><X size={22} /></button>
				<div className="mission-image-viewer-viewport">
					<img src={preview.url} alt={preview.name} onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={imageSize.width ? { width: `${Math.round(imageSize.width * fit * zoom)}px`, maxWidth: 'none', maxHeight: 'none' } : undefined} />
				</div>
		</div>, preview.ownerDocument.body
	)}{videoPreview && createPortal(
		<div className="mission-image-viewer-backdrop mission-video-viewer" role="dialog" aria-modal="true" aria-label={`播放视频：${videoPreview.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setVideoPreview(null); }}>
			<button className="mission-image-viewer-close" type="button" aria-label="关闭视频预览" ref={closeButtonRef} onClick={() => setVideoPreview(null)}><X size={22} /></button>
			<div className="mission-video-viewer-content"><video key={videoPreview.url} src={videoPreview.url} controls autoPlay playsInline /><span>{videoPreview.name}</span></div>
		</div>, videoPreview.ownerDocument.body
	)}</>;
});
