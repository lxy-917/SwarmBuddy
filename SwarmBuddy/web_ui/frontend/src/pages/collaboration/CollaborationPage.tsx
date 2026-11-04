import { UserMsg } from '@agentscope-ai/agentscope/message';
import type { Msg } from '@agentscope-ai/agentscope/message';
import { ArrowUpRight, BookOpen, BotMessageSquare, Download, FileText, LoaderCircle, Network, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { buildCollaborationPrompt, COLLABORATION_AGENT_NAME, COLLABORATION_AGENT_PROMPT, parseCollaborationDraft } from './collaborationDraft';
import type { CollaborationDraft, Evidence } from './collaborationDraft';
import './collaboration.css';
import { agentApi, chatApi, knowledgeBaseApi, sessionApi } from '@/api';
import type { ChatModelConfig, KnowledgeBaseView } from '@/api';
import { client, getUserId } from '@/api/client';
import { missionScanApi } from '@/api/missionScan';
import type { ScanResult } from '@/api/missionScan';
import { useAgents } from '@/hooks/useAgents';
import { useAvailableModels } from '@/hooks/useAvailableModels';
import { useSessions } from '@/hooks/useSessions';
import { isKnowledgeChatAgent } from '@/pages/knowledge/knowledgeChat';

type ReportState = {
	draft: CollaborationDraft;
	scan: ScanResult;
	agentId: string;
	sessionId: string;
	analysisMessageId: string;
	generatedAt: string;
};

type PendingReport = {
	collaborationAgentId: string;
	collaborationSessionId: string;
	sourceAgentId: string;
	sourceSessionId: string;
	analysisMessageId: string;
	evidence: Evidence[];
	scan: ScanResult;
	startedAt: string;
};

function pendingKey(): string {
	return `swarmbuddy:collaboration-pending:${getUserId()}`;
}

function readPendingReport(): PendingReport | null {
	try {
		const saved = localStorage.getItem(pendingKey());
		if (!saved) return null;
		const value = JSON.parse(saved) as PendingReport;
		if (!value.collaborationAgentId || !value.collaborationSessionId || !value.sourceAgentId || !value.sourceSessionId || !value.scan || !Array.isArray(value.evidence)) return null;
		return value;
	} catch {
		return null;
	}
}

function messageText(message: Msg): string {
	return message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
}

function sourceLabel(value: string): string {
	return value.replaceAll('\\', '/').split('/').at(-1) || value;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : '操作失败，请稍后重试。';
}

export function CollaborationPage() {
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const { agents, loading: agentsLoading, error: agentsError } = useAgents();
	const [pending, setPending] = useState<PendingReport | null>(readPendingReport);
	const generationToken = useRef(0);
	const preparingSession = useRef<{ agentId: string; sessionId: string } | null>(null);
	const [sourceAgentId, setSourceAgentId] = useState(() => pending?.sourceAgentId ?? params.get('agent') ?? '');
	const [sourceSessionId, setSourceSessionId] = useState(() => pending?.sourceSessionId ?? params.get('session') ?? '');
	const [analysisMessageId, setAnalysisMessageId] = useState(() => pending?.analysisMessageId ?? '');
	const { sessions, loading: sessionsLoading } = useSessions(sourceAgentId || null);
	const { groups: modelGroups } = useAvailableModels();
	const [scan, setScan] = useState<ScanResult | null>(null);
	const [sourceMessages, setSourceMessages] = useState<Msg[]>([]);
	const [sourceLoading, setSourceLoading] = useState(false);
	const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseView[]>([]);
	const [useKnowledge, setUseKnowledge] = useState(false);
	const [knowledgeBaseId, setKnowledgeBaseId] = useState('');
	const [preparing, setPreparing] = useState(false);
	const [canceling, setCanceling] = useState(false);
	const [pendingNotice, setPendingNotice] = useState<string | null>(pending ? '正在恢复生成进度…' : null);
	const [exporting, setExporting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [report, setReport] = useState<ReportState | null>(null);
	const generating = preparing || pending !== null || canceling;

	const sourceAgents = agents.filter((agent) => agent.data.name !== COLLABORATION_AGENT_NAME && !isKnowledgeChatAgent(agent.data.name));
	const analysisMessages = sourceMessages.filter((message) => message.role === 'assistant' && Boolean(message.finished_at) && Boolean(messageText(message)));
	const selectedAnalysis = analysisMessages.find((message) => message.id === analysisMessageId);
	const reportModels = Object.entries(modelGroups).flatMap(([type, records]) => records.flatMap(({ credential, models }) => models.filter((model) => model.type === 'chat_model' && model.status !== 'sunset' && model.name === 'deepseek-v4-pro').map(() => ({ type, credential_id: credential.id, model: 'deepseek-v4-pro', parameters: { thinking_enable: true, ...(type === 'dashscope_credential' ? { search_enable: false } : {}) } } satisfies ChatModelConfig))));
	const selectedModel = reportModels.find((model) => model.type === 'dashscope_credential') ?? reportModels[0];

	useEffect(() => {
		if (!sourceAgentId && sourceAgents.length) setSourceAgentId(sourceAgents[0].id);
	}, [sourceAgentId, sourceAgents]);
	useEffect(() => {
		if (!sourceAgentId || sourceSessionId || !sessions.length) return;
		setSourceSessionId(sessions[0].session.id);
	}, [sourceAgentId, sourceSessionId, sessions]);
	useEffect(() => {
		let active = true;
		void knowledgeBaseApi.listAll().then((bases) => {
			if (active) setKnowledgeBases(bases);
		}).catch((cause: unknown) => { if (active) setError(errorText(cause)); });
		return () => { active = false; };
	}, []);
	useEffect(() => {
		setScan(null);
		setSourceMessages([]);
		const savedJob = readPendingReport();
		setAnalysisMessageId(savedJob?.sourceAgentId === sourceAgentId && savedJob.sourceSessionId === sourceSessionId ? savedJob.analysisMessageId : '');
		setReport(null);
		if (!sourceAgentId || !sourceSessionId) return;
		let active = true;
		setSourceLoading(true);
		setError(null);
		void Promise.all([
			missionScanApi.get(sourceAgentId, sourceSessionId),
			sessionApi.messages(sourceSessionId, sourceAgentId, { limit: 100 }),
		]).then(([result, history]) => {
			if (!active) return;
			setScan(result);
			setSourceMessages(history.messages);
			const latest = [...history.messages].reverse().find((message) => message.role === 'assistant' && message.finished_at && messageText(message));
			setAnalysisMessageId((previous) => history.messages.some((message) => message.id === previous) ? previous : latest?.id ?? '');
		}).catch((cause: unknown) => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setSourceLoading(false); });
		return () => { active = false; };
	}, [sourceAgentId, sourceSessionId]);

	useEffect(() => {
		if (!pending) return;
		let active = true;
		const pollToken = generationToken.current;
		let observedRunning = false;
		let idleChecks = 0;
		const clearPending = () => {
			localStorage.removeItem(pendingKey());
			setPending(null);
			setPendingNotice(null);
		};
		const poll = async () => {
			while (active) {
				try {
					const history = await sessionApi.messages(pending.collaborationSessionId, pending.collaborationAgentId, { limit: 30 });
					if (!active || pollToken !== generationToken.current) return;
					const assistant = [...history.messages].reverse().find((message) => message.role === 'assistant');
					if (assistant?.finished_at) {
						if (assistant.error?.message) throw new Error(assistant.error.message);
						const draft = parseCollaborationDraft(messageText(assistant), pending.evidence);
						const latestScan = await missionScanApi.get(pending.sourceAgentId, pending.sourceSessionId);
						if (!active || pollToken !== generationToken.current) return;
						if (JSON.stringify(latestScan) !== JSON.stringify(pending.scan)) throw new Error('扫描结果已更新，请重新生成规划文档。');
						setReport({ draft, scan: pending.scan, agentId: pending.sourceAgentId, sessionId: pending.sourceSessionId, analysisMessageId: pending.analysisMessageId, generatedAt: new Date().toISOString() });
						setAnalysisMessageId(pending.analysisMessageId);
						setError(null);
						clearPending();
						return;
					}
					if (history.is_running) {
						observedRunning = true;
						idleChecks = 0;
						setPendingNotice('模型正在生成规划内容，请稍候…');
					} else if (observedRunning) {
						idleChecks += 1;
						if (idleChecks >= 3) throw new Error('模型运行已停止，但没有保存回复。请检查模型服务后重试。');
						setPendingNotice('正在接收并保存生成结果…');
					} else {
						setPendingNotice(Date.now() - Date.parse(pending.startedAt) > 30_000
							? '尚未收到模型启动信号，仍在检查。若持续无响应，可取消后重试。'
							: '已提交生成任务，正在等待模型服务响应…');
					}
					setError(null);
				} catch (cause) {
					if (!active) return;
					if (cause instanceof Error && /Network|network|Failed to fetch|fetch failed|连接|超时/.test(cause.message)) {
						setPendingNotice('连接暂时中断，正在继续检查生成结果…');
					} else {
						setError(errorText(cause));
						clearPending();
						return;
					}
				}
				await new Promise((resolve) => window.setTimeout(resolve, 1500));
			}
		};
		void poll();
		return () => { active = false; };
	}, [pending]);

	const cancelGeneration = async () => {
		if ((!pending && !preparing) || canceling) return;
		generationToken.current += 1;
		setCanceling(true);
		try {
			const target = pending
				? { agentId: pending.collaborationAgentId, sessionId: pending.collaborationSessionId }
				: preparingSession.current;
			if (target) await sessionApi.interrupt(target.sessionId, target.agentId);
			localStorage.removeItem(pendingKey());
			setPending(null);
			setPreparing(false);
			preparingSession.current = null;
			setPendingNotice(null);
			setReport(null);
			setError(null);
		} catch (cause) {
			if (pending) setPending({ ...pending });
			else setPreparing(false);
			setError(errorText(cause));
		} finally {
			setCanceling(false);
		}
	};

	const generate = async () => {
		if (!scan || !selectedAnalysis || !sourceSessionId || !sourceAgentId || generating) return;
		if (!selectedModel) { setError('请先在凭证中配置 DeepSeek V4 Pro。'); return; }
		if (useKnowledge && !knowledgeBaseId) { setError('请先选择要结合的知识库。'); return; }
		const runToken = ++generationToken.current;
		preparingSession.current = null;
		setPreparing(true);
		setReport(null);
		setError(null);
		setPendingNotice('正在准备生成资料…');
		try {
			let evidence: Evidence[] = [];
			if (useKnowledge) {
				const result = await knowledgeBaseApi.search(knowledgeBaseId, { query: '无人艇海域扫描 航线覆盖 航速与作业时间 障碍物避让 规划风险', top_k: 5 });
				if (runToken !== generationToken.current) return;
				evidence = result.results.map((hit, index) => {
					const metadata = hit.chunk.metadata;
					const pageValue = metadata.page_number ?? metadata.page ?? metadata.page_index;
					const text = hit.chunk.content.type === 'text' && typeof hit.chunk.content.text === 'string' ? hit.chunk.content.text : '';
					return { id: `K${index + 1}`, source: sourceLabel(hit.chunk.source), page: pageValue == null ? null : String(pageValue), text };
				}).filter((item) => item.text.trim());
				if (!evidence.length) throw new Error('所选知识库未找到相关内容，请更换知识库或关闭结合知识库。');
			}
			const { agents: currentAgents } = await agentApi.list();
			if (runToken !== generationToken.current) return;
			const agentId = currentAgents.find((agent) => agent.data.name === COLLABORATION_AGENT_NAME && agent.data.system_prompt === COLLABORATION_AGENT_PROMPT)?.id
				?? (await agentApi.create({ name: COLLABORATION_AGENT_NAME, system_prompt: COLLABORATION_AGENT_PROMPT })).agent_id;
			if (runToken !== generationToken.current) return;
			const { session_id: sessionId } = await sessionApi.create({ agent_id: agentId, chat_model_config: selectedModel });
			if (runToken !== generationToken.current) return;
			preparingSession.current = { agentId, sessionId };
			const now = new Date().toISOString();
			const prompt = buildCollaborationPrompt(scan, messageText(selectedAnalysis), evidence);
			const input = UserMsg({ name: 'user', content: [{ id: crypto.randomUUID(), type: 'text', text: prompt, created_at: now, finished_at: now }] });
			await chatApi.trigger({ agent_id: agentId, session_id: sessionId, input });
			if (runToken !== generationToken.current) {
				await sessionApi.interrupt(sessionId, agentId).catch(() => undefined);
				return;
			}
			const job: PendingReport = {
				collaborationAgentId: agentId,
				collaborationSessionId: sessionId,
				sourceAgentId,
				sourceSessionId,
				analysisMessageId: selectedAnalysis.id,
				evidence,
				scan,
				startedAt: now,
			};
			localStorage.setItem(pendingKey(), JSON.stringify(job));
			setPending(job);
		} catch (cause) {
			if (runToken === generationToken.current) {
				setError(errorText(cause));
				setPendingNotice(null);
			}
		} finally {
			if (runToken === generationToken.current) {
				preparingSession.current = null;
				setPreparing(false);
			}
		}
	};

	const exportPdf = async () => {
		if (!report || exporting) return;
		setExporting(true);
		setError(null);
		try {
			const latestScan = await missionScanApi.get(report.agentId, report.sessionId);
			if (JSON.stringify(latestScan) !== JSON.stringify(report.scan)) throw new Error('扫描结果已更新，请重新生成规划文档。');
			const response = await client.stream('/collaboration/report/pdf', { method: 'POST', body: {
				source_agent_id: report.agentId,
				source_session_id: report.sessionId,
				analysis_message_id: report.analysisMessageId,
				generated_at: report.generatedAt,
				...report.draft,
			} });
			if (response.headers.get('X-SwarmBuddy-Report-Version') !== '5') throw new Error('报告服务仍在使用旧版模板，请重启海域服务后重新下载。');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `海域扫描规划评估-${report.sessionId}.pdf`;
			document.body.append(link);
			link.click();
			link.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (cause) {
			setError(errorText(cause));
		} finally {
			setExporting(false);
		}
	};

	return <main className="collaboration-page">
		<div className="collaboration-content">
			<div className="collaboration-layout">
				<section className="collaboration-setup" aria-label="规划资料来源">
					<header className="collaboration-sidebar-head"><h1>智能协同</h1><p>汇集扫描方案与分析建议</p><span><Network size={15} /> 海域扫描规划文档</span></header>
					<div className="collaboration-section-title"><span>01</span><div><h2>导入聊天方案</h2><p>选择已生成海域扫描结果的会话</p></div></div>
					<label>项目<select value={sourceAgentId} disabled={agentsLoading || generating} onChange={(event) => { setSourceAgentId(event.target.value); setSourceSessionId(''); }}><option value="">选择项目</option>{sourceAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.data.name}</option>)}</select></label>
					<label>聊天会话<select value={sourceSessionId} disabled={!sourceAgentId || sessionsLoading || generating} onChange={(event) => setSourceSessionId(event.target.value)}><option value="">选择会话</option>{sessions.map((view) => <option key={view.session.id} value={view.session.id}>{view.session.config.name || new Date(view.session.created_at).toLocaleString('zh-CN')}</option>)}</select></label>
					<label>导入分析建议<select value={analysisMessageId} disabled={!analysisMessages.length || sourceLoading || generating} onChange={(event) => { setAnalysisMessageId(event.target.value); setReport(null); }}><option value="">选择智能体回复</option>{analysisMessages.map((message) => <option key={message.id} value={message.id}>{messageText(message).slice(0, 55)}{messageText(message).length > 55 ? '…' : ''}</option>)}</select></label>
					{sourceLoading && <p className="collaboration-inline"><LoaderCircle size={14} className="collaboration-spin" /> 正在读取会话资料…</p>}
					{scan && <div className="collaboration-source-summary"><span>{scan.source === 'demo' ? '示例海域' : '已导入海域数据'}</span><strong>覆盖 {scan.planned_coverage_percent.toFixed(1)}%</strong><strong>航程 {(scan.path_length_m / 1000).toFixed(1)} km</strong></div>}
					{sourceSessionId && !sourceLoading && !scan && <p className="collaboration-inline">该会话尚无可导入的海域扫描结果。</p>}
					<div className="collaboration-section-title collaboration-second"><span>02</span><div><h2>专业知识</h2><p>按需引用知识库资料</p></div></div>
					<label className="collaboration-toggle"><input type="checkbox" checked={useKnowledge} disabled={generating} onChange={(event) => { setUseKnowledge(event.target.checked); setReport(null); }} /><span>结合知识库</span></label>
					{useKnowledge && <label>知识库<select value={knowledgeBaseId} disabled={generating} onChange={(event) => { setKnowledgeBaseId(event.target.value); setReport(null); }}><option value="">选择知识库</option>{knowledgeBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label>}
					<div className="collaboration-section-title collaboration-second"><span>03</span><div><h2>生成规划文档</h2><p>数值直接取自扫描结果</p></div></div>
					<p className="collaboration-mode-note">统一使用 DeepSeek V4 Pro 深度思考；生成后可预览并下载 PDF。</p>
					<div className="collaboration-generation-actions">
						<button className="collaboration-generate" type="button" disabled={!scan || !selectedAnalysis || generating || (useKnowledge && !knowledgeBaseId)} onClick={() => void generate()}>{generating ? <LoaderCircle size={17} className="collaboration-spin" /> : <Sparkles size={17} />} {generating ? '正在生成报告…' : '生成规划报告'}</button>
						{generating && <button className="collaboration-cancel" type="button" disabled={canceling} onClick={() => void cancelGeneration()}>{canceling ? '正在取消…' : '取消生成'}</button>}
					</div>
					{generating && <div className="collaboration-pending"><span><LoaderCircle size={14} className="collaboration-spin" />{pendingNotice || '正在等待模型回复…'}</span></div>}
					{agentsError && <p className="collaboration-error" role="alert">{agentsError.message}</p>}
					{error && <p className="collaboration-error" role="alert">{error}</p>}
				</section>

				<section className="collaboration-preview" aria-label="规划文档预览">
					<div className="collaboration-preview-head"><div><span>文档预览</span><h2>规划评估报告</h2></div>{report && <button type="button" onClick={() => void exportPdf()} disabled={exporting}><Download size={16} /> {exporting ? '正在导出…' : '下载 PDF'}</button>}</div>
					{report ? <div className="collaboration-report">
						<div className="collaboration-report-meta"><span>{report.scan.source === 'demo' ? '示例海域' : '已导入海域数据'}</span><span>规划估计 · 非实测结果</span></div>
						<h3>海域扫描规划评估</h3>
						<p>{report.draft.assessment}</p>
						<div className="collaboration-report-metrics"><div><small>预计覆盖率</small><strong>{report.scan.planned_coverage_percent.toFixed(1)}%</strong></div><div><small>规划航程</small><strong>{(report.scan.path_length_m / 1000).toFixed(1)} km</strong></div><div><small>预计耗时</small><strong>{report.scan.estimated_duration_hours != null ? `${report.scan.estimated_duration_hours.toFixed(1)} 小时` : '待计算'}</strong></div></div>
						<h4>覆盖结果评估</h4><p>{report.draft.coverage_analysis}</p>
						<h4>航线与效率评估</h4><p>{report.draft.route_analysis}</p>
						<h4>作业条件分析</h4><p>{report.draft.execution_analysis}</p>
						<h4>主要风险</h4><ol>{report.draft.risks.map((item, index) => <li key={index}>{item}</li>)}</ol>
						<h4>待补充资料</h4><ol>{report.draft.data_gaps.map((item, index) => <li key={index}>{item}</li>)}</ol>
						<h4>实施建议</h4><ol>{report.draft.recommendations.map((item, index) => <li key={index}>{item}</li>)}</ol>
						<h4>相关专业知识</h4>{report.draft.knowledge_items.length ? <ul>{report.draft.knowledge_items.map((item, index) => <li key={index}>{item.point}<small>来源：{item.source}{item.page ? `，第 ${item.page} 页` : ''}</small></li>)}</ul> : <p className="collaboration-no-knowledge">未引用知识库资料；专业依据请结合项目资料核验。</p>}
					</div> : <div className="collaboration-empty"><FileText size={35} strokeWidth={1.4} /><h3>规划文档将在这里预览</h3><p>导入聊天方案后，文档 Agent 将整理关键结论、风险、建议和相关专业知识。</p><div><button type="button" onClick={() => navigate('/mission')}><BotMessageSquare size={15} /> 前往聊天 <ArrowUpRight size={14} /></button><button type="button" onClick={() => navigate('/knowledge')}><BookOpen size={15} /> 查看知识库 <ArrowUpRight size={14} /></button></div></div>}
				</section>
			</div>
		</div>
	</main>;
}
