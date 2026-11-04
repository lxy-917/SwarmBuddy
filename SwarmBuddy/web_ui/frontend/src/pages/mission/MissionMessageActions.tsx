import {
	Check, Copy, Download, Ellipsis, RotateCcw, Share2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { copyToClipboard } from '@/utils/common';

interface MissionMessageActionsProps {
	messageId: string;
	text: string;
	canRegenerate: boolean;
	onRegenerate: () => Promise<void>;
	showShare?: boolean;
	iconOnly?: boolean;
}

export function MissionMessageActions({
	messageId, text, canRegenerate, onRegenerate, showShare = true, iconOnly = false,
}: MissionMessageActionsProps) {
	const [open, setOpen] = useState(false);
	const [notice, setNotice] = useState('');
	const [regenerating, setRegenerating] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const doc = containerRef.current?.ownerDocument;
		if (!doc) return;
		const closeOnOutside = (event: PointerEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		doc.addEventListener('pointerdown', closeOnOutside);
		doc.addEventListener('keydown', closeOnEscape);
		return () => {
			doc.removeEventListener('pointerdown', closeOnOutside);
			doc.removeEventListener('keydown', closeOnEscape);
		};
	}, [open]);

	const showNotice = (value: string) => {
		setNotice(value);
		window.setTimeout(() => setNotice(''), 2500);
	};

	const copyReply = async () => {
		if (!text) return;
		const success = await copyToClipboard(text);
		showNotice(success ? '已复制' : '复制失败');
		setOpen(false);
	};

	const downloadReply = () => {
		if (!text) return;
		const doc = containerRef.current?.ownerDocument;
		if (!doc) return;
		const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
		const link = doc.createElement('a');
		link.href = url;
		link.download = `swarmbuddy-reply-${messageId.slice(0, 8)}.txt`;
		doc.body.append(link);
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
		setOpen(false);
	};

	const regenerate = async () => {
		if (!canRegenerate || regenerating) return;
		setRegenerating(true);
		setOpen(false);
		try {
			await onRegenerate();
		} finally {
			setRegenerating(false);
		}
	};

	const shareReply = async () => {
		if (!text) return;
		setOpen(false);
		if (navigator.share) {
			try {
				await navigator.share({ title: 'SwarmBuddy 回复', text });
				return;
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') return;
			}
		}
		const success = await copyToClipboard(text);
		showNotice(success ? '分享内容已复制' : '分享失败');
	};

	return (
		<div className="mission-reply-actions" ref={containerRef}>
			{!iconOnly && <button className="mission-reply-copy" type="button" aria-label="复制回复" title="复制回复" disabled={!text} onClick={() => void copyReply()}>{notice === '已复制' ? <Check size={16} /> : <Copy size={16} />}</button>}
			<button
				className="mission-more-button"
				type="button"
				aria-label="更多回复操作"
				aria-expanded={open}
				aria-haspopup="menu"
				onClick={() => setOpen((value) => !value)}
			>
				{iconOnly ? <Ellipsis size={17} /> : notice ? <Check size={15} /> : <Ellipsis size={17} />}
				{iconOnly ? notice && <span className="sr-only" role="status">{notice}</span> : <span className={notice ? 'mission-more-feedback' : 'mission-more-label'}>{notice || '更多'}</span>}
			</button>
			{open && (
				<div className="mission-more-menu" role="menu" aria-label="回复操作">
					<div className="mission-more-quick-actions" role="group" aria-label="快捷操作">
						{iconOnly && <button type="button" role="menuitem" aria-label="复制" data-tooltip="复制" disabled={!text} onClick={() => void copyReply()}>
							<Copy size={18} />
						</button>}
						<button type="button" role="menuitem" aria-label="导出" data-tooltip="导出" disabled={!text} onClick={downloadReply}>
							<Download size={18} />
						</button>
						<button type="button" role="menuitem" aria-label="重新生成" data-tooltip={canRegenerate ? '重新生成' : '当前无法重新生成'} disabled={!canRegenerate || regenerating} onClick={() => void regenerate()}>
							<RotateCcw size={18} />
						</button>
						{showShare && <button type="button" role="menuitem" aria-label="分享" data-tooltip="分享" disabled={!text} onClick={() => void shareReply()}>
							<Share2 size={18} />
						</button>}
					</div>
				</div>
			)}
		</div>
	);
}
