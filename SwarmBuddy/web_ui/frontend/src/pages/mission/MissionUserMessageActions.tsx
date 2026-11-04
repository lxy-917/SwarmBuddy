import { Check, Copy, MessageSquareQuote, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { copyToClipboard } from '@/utils/common';

interface MissionUserMessageActionsProps {
	text: string;
	canDelete: boolean;
	onQuote: () => void;
	onDelete: () => void;
}

export function MissionUserMessageActions({ text, canDelete, onQuote, onDelete }: MissionUserMessageActionsProps) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		if (!text) return;
		if (await copyToClipboard(text)) {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1800);
		} else {
			toast.error('复制失败');
		}
	};

	return <div className="mission-user-actions" role="group" aria-label="消息操作">
		<button type="button" aria-label="复制消息" disabled={!text} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}<span>{copied ? '已复制' : '复制'}</span></button>
		<button type="button" aria-label="引用消息" disabled={!text} onClick={onQuote}><MessageSquareQuote size={16} /><span>引用</span></button>
		<button className="mission-user-delete-action" type="button" aria-label="选择要删除的消息" disabled={!canDelete} onClick={onDelete}><Trash2 size={16} /><span>删除</span></button>
	</div>;
}
