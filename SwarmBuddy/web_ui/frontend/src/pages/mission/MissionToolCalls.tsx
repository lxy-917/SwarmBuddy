import type { ContentBlock, ToolCallBlock } from '@agentscope-ai/agentscope/message';
import { Check, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { parseInput, tryGetFilePath } from '@/components/chat/tool-renderers/_shared';

interface MissionToolCallsProps {
	content: ContentBlock[];
	replyId: string;
	onUserConfirm: (toolCall: ToolCallBlock, confirmed: boolean, replyId: string) => Promise<void>;
}

function stringArg(input: Record<string, unknown>, ...names: string[]): string | undefined {
	for (const name of names) {
		const value = input[name];
		if (typeof value === 'string' && value.trim()) return value;
	}
	return undefined;
}

function toolIntent(call: ToolCallBlock): { title: string; description: string; detail?: string } {
	const input = parseInput(call.input);
	const description = stringArg(input, 'description', 'reason', 'purpose');
	if (call.name === 'Write') {
		const path = tryGetFilePath(call.input) ?? stringArg(input, 'path');
		const content = stringArg(input, 'content');
		const lines = content ? content.split(/\r?\n/).length : null;
		return {
			title: 'Agent 准备写入或覆盖文件',
			description: path ? `目标文件：${path}` : '目标文件路径未提供',
			detail: lines ? `预计写入 ${lines} 行内容` : undefined,
		};
	}
	if (call.name === 'PowerShell' || call.name === 'Bash') {
		return {
			title: `Agent 准备运行 ${call.name} 命令`,
			description: description ?? '将在终端执行以下命令：',
			detail: stringArg(input, 'command', 'script', 'cmd', 'code') ?? call.input,
		};
	}
	if (call.name === 'Read' || call.name === 'Edit') {
		const path = tryGetFilePath(call.input) ?? stringArg(input, 'path');
		return {
			title: call.name === 'Read' ? 'Agent 准备读取文件' : 'Agent 准备修改文件',
			description: path ? `目标文件：${path}` : '目标文件路径未提供',
			detail: description,
		};
	}
	const raw = call.input.trim();
	return {
		title: `Agent 准备使用 ${call.name}`,
		description: description ?? '操作参数如下：',
		detail: raw ? raw.slice(0, 2000) + (raw.length > 2000 ? '…' : '') : undefined,
	};
}

export function MissionToolCalls({ content, replyId, onUserConfirm }: MissionToolCallsProps) {
	const [busyId, setBusyId] = useState<string | null>(null);
	const [autoBusyId, setAutoBusyId] = useState<string | null>(null);
	const [submittedIds, setSubmittedIds] = useState<Set<string>>(() => new Set());
	const [autoFailedIds, setAutoFailedIds] = useState<Set<string>>(() => new Set());
	const [error, setError] = useState<string | null>(null);
	const autoAttemptedIds = useRef(new Set<string>());
	const autoProcessing = useRef(false);
	const completedIds = new Set(content.filter((block) => block.type === 'tool_result').map((block) => block.id));
	const pendingCalls = content.filter((block): block is ToolCallBlock => block.type === 'tool_call' && block.state === 'asking' && !completedIds.has(block.id) && !submittedIds.has(block.id));
	const autoWrites = pendingCalls.filter((call) => call.name === 'Write' && !autoFailedIds.has(call.id));
	const manualCalls = pendingCalls.filter((call) => call.name !== 'Write' || autoFailedIds.has(call.id));

	useEffect(() => {
		if (autoProcessing.current) return;
		const writes = autoWrites.filter((call) => !autoAttemptedIds.current.has(call.id));
		if (writes.length === 0) return;
		autoProcessing.current = true;
		// 用户已授权 Write 默认允许；逐项提交，避免多个确认事件并发。
		void (async () => {
			for (const call of writes) {
				autoAttemptedIds.current.add(call.id);
				setAutoBusyId(call.id);
				try {
					await onUserConfirm(call, true, replyId);
					setSubmittedIds((ids) => new Set(ids).add(call.id));
				} catch (reason) {
					setAutoFailedIds((ids) => new Set(ids).add(call.id));
					setError(reason instanceof Error ? reason.message : '自动允许写入失败，请手动确认');
				}
			}
			autoProcessing.current = false;
			setAutoBusyId(null);
		})();
	}, [autoWrites, onUserConfirm, replyId]);

	const confirm = async (call: ToolCallBlock, approved: boolean) => {
		if (busyId) return;
		setBusyId(call.id);
		setError(null);
		try {
			await onUserConfirm(call, approved, replyId);
			setSubmittedIds((ids) => new Set(ids).add(call.id));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : '授权操作失败，请重试');
		} finally {
			setBusyId(null);
		}
	};

	if (pendingCalls.length === 0 && !error) return null;
	return (
		<div className="mission-tool-calls" aria-label="待授权操作">
			{autoWrites.map((call) => {
				const intent = toolIntent(call);
				return <div className="mission-tool-approval mission-tool-auto" key={call.id} role="status">
					<div className="mission-tool-approval-main"><strong>{intent.title}</strong><span>{intent.description}</span>{intent.detail && <small>{intent.detail}</small>}</div>
					<span className="mission-tool-auto-status">{autoBusyId === call.id ? '正在自动允许…' : '将自动允许'}</span>
				</div>;
			})}
			{manualCalls.map((call) => {
				const intent = toolIntent(call);
				return <div className="mission-tool-approval" key={call.id}>
					<div className="mission-tool-approval-main"><strong>{intent.title}</strong><span>{intent.description}</span>{intent.detail && <pre>{intent.detail}</pre>}</div>
					<button type="button" disabled={Boolean(busyId)} onClick={() => void confirm(call, true)}><Check size={14} />允许</button>
					<button type="button" disabled={Boolean(busyId)} onClick={() => void confirm(call, false)}><X size={14} />拒绝</button>
					{busyId === call.id && <Loader2 className="mission-tool-spinner" size={14} />}
				</div>;
			})}
			{error && <p className="mission-tool-error" role="alert">{error}</p>}
		</div>
	);
}
