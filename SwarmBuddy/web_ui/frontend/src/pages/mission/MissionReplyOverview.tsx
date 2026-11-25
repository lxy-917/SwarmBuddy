import type { ContentBlock } from '@agentscope-ai/agentscope/message';
import {
	Activity, ArrowUpRight, Check, ChevronDown, Circle, ClipboardList, Clock3,
	LoaderCircle, MapPin, Route, ShieldCheck, TriangleAlert, X,
} from 'lucide-react';
import { memo } from 'react';
import type { ReactNode } from 'react';

import { getMissionReplyActivity } from './missionReplyActivity';
import type { ReplyActivityState, ReplyPlan } from './missionReplyActivity';
import { formatMissionClock, formatMissionDateTime } from './missionTime';
import { RobotAvatar } from './RobotAvatar';

const activityStates = {
	success: { label: '完成', icon: Check },
	running: { label: '处理中', icon: LoaderCircle },
	waiting: { label: '待执行', icon: Circle },
	confirm: { label: '待确认', icon: Clock3 },
	missing: { label: '暂无结果', icon: Circle },
	error: { label: '失败', icon: TriangleAlert },
	interrupted: { label: '已中断', icon: X },
	denied: { label: '已拒绝', icon: X },
} satisfies Record<ReplyActivityState, { label: string; icon: typeof Check }>;

const planSourceNames = { demo: '示例海域', provided: '导入海域数据', bounds_only: '经纬度边界' };

export function MissionReplyFrame({ startedAt, duration, children, actions }: {
	startedAt?: string;
	duration?: string | null;
	children: ReactNode;
	actions?: ReactNode;
}) {
	const clock = startedAt ? formatMissionClock(startedAt) : '';
	return <article className="assistant-row mission-message mission-chat-reply">
		<RobotAvatar small />
		<div className="mission-reply-content">
			<header className="mission-reply-byline">
				<strong>SwarmBuddy</strong>
				<span className="mission-reply-role">智能体</span>
				{startedAt && clock && <time dateTime={startedAt} title={formatMissionDateTime(startedAt)}>{clock}</time>}
				{duration && <span className="mission-reply-duration">用时 {duration}</span>}
			</header>
			<div className="assistant-bubble">{children}</div>
			{actions && <div className="mission-assistant-footer">{actions}</div>}
		</div>
	</article>;
}

function MissionReplyPlan({ plan, onOpenAnalysis }: { plan: ReplyPlan; onOpenAnalysis?: () => void }) {
	const { bounds } = plan;
	const details = [
		...(plan.durationHours !== undefined ? [{ name: '预计耗时', value: `${plan.durationHours.toFixed(2)} 小时` }] : []),
		...(plan.obstacles !== undefined ? [{ name: '障碍物', value: `${plan.obstacles} 处` }] : []),
	];
	return <section className="mission-reply-plan" aria-label="扫描方案预览">
		<header className="mission-reply-plan-heading">
			<h3><ClipboardList size={15} aria-hidden="true" />{plan.origin === 'planned' ? '任务方案预览' : '扫描方案预览'}</h3>
			{plan.source && <span>{planSourceNames[plan.source]}</span>}
		</header>
		<div className="mission-reply-plan-metrics">
			<div><span>规划覆盖率</span><strong>{plan.coveragePercent.toFixed(1)}%</strong></div>
			<div><span>规划总航程</span><strong>{(plan.distanceM / 1000).toFixed(1)} <small>km</small></strong></div>
		</div>
		<ul className="mission-reply-plan-rows">
			{bounds && <li>
				<span className="mission-reply-plan-icon"><MapPin size={16} aria-hidden="true" /></span>
				<div><strong>扫描范围</strong><small>{bounds.west.toFixed(4)}° 至 {bounds.east.toFixed(4)}° 经度 · {bounds.south.toFixed(4)}° 至 {bounds.north.toFixed(4)}° 纬度</small></div>
			</li>}
			{(plan.vessels !== undefined || plan.waypoints !== undefined) && <li>
				<span className="mission-reply-plan-icon"><Route size={16} aria-hidden="true" /></span>
				<div><strong>航迹与分区</strong><small>{[
					plan.vessels !== undefined ? `${plan.vessels} 艘无人艇` : '',
					plan.waypoints !== undefined ? `${plan.waypoints} 个规划航点` : '',
				].filter(Boolean).join(' · ')}</small></div>
			</li>}
			{plan.validated !== undefined && <li>
				<span className="mission-reply-plan-icon" data-warning={!plan.validated}><ShieldCheck size={16} aria-hidden="true" /></span>
				<div><strong>规划几何校验</strong><small>{plan.validated ? '校验通过' : '未通过校验'}</small></div>
			</li>}
		</ul>
		{(details.length > 0 || onOpenAnalysis) && <footer className="mission-reply-plan-footer">
			{details.length > 0 && <details className="mission-reply-plan-details">
				<summary>查看详情 <ChevronDown size={13} aria-hidden="true" /></summary>
				<dl>{details.map(({ name, value }) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
			</details>}
			{onOpenAnalysis && <button type="button" className="mission-reply-plan-link" onClick={onOpenAnalysis}>打开当前数据分析 <ArrowUpRight size={13} aria-hidden="true" /></button>}
		</footer>}
	</section>;
}

export const MissionReplyOverview = memo(function MissionReplyOverview({ content, userContent, finished, onOpenAnalysis }: {
	content: ContentBlock[];
	userContent?: ContentBlock[];
	finished: boolean;
	onOpenAnalysis?: () => void;
}) {
	const { steps, plan } = getMissionReplyActivity(content, userContent, finished);
	if (!steps.length && !plan) return null;
	return <div className="mission-reply-overview">
		{steps.length > 0 && <section className="mission-reply-activity" aria-label="任务处理步骤">
			<header className="mission-reply-activity-heading">
				<h3><Activity size={15} aria-hidden="true" />{finished ? '任务处理记录' : '任务处理进度'}</h3>
			</header>
			<ol>
				{steps.map(({ id, label, state, statusText }) => {
					const { icon: Icon, label: defaultStatusText } = activityStates[state];
					return <li key={id} data-state={state}>
						<span className="mission-reply-step-icon"><Icon size={12} aria-hidden="true" /></span>
						<span className="mission-reply-step-label" title={label}>{label}</span>
						<span className="mission-reply-step-status">{statusText ?? defaultStatusText}</span>
					</li>;
				})}
			</ol>
		</section>}
		{plan && <MissionReplyPlan plan={plan} onOpenAnalysis={onOpenAnalysis} />}
	</div>;
});
