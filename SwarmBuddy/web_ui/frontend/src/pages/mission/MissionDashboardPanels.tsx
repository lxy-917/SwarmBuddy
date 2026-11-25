import {
	Activity, BarChart3, CheckCircle2, ChevronRight, Clock3, Crosshair,
	List, MapPin, Pause, Play, Route, ScanLine, Target,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { formatMissionElapsed, simulatedCoverage, simulationAssets } from './missionCooperationSimulation';
import type { CooperationSimulation } from './missionCooperationSimulation';
import { fleetFinished } from './missionFleet';
import type { FleetPoint } from './missionFleet';
import { UavIcon, UsvIcon } from './MissionPlatformIcons';
import { formatMissionDateTime } from './missionTime';
import { SCAN_ROUTE_COLORS } from './scanDefaults';
import { formatPlannedScanDuration } from './scanSpeed';
import type { ScanResult } from '@/api/missionScan';

function Card({ title, icon: Icon, action, children }: {
	title: string;
	icon: LucideIcon;
	action?: ReactNode;
	children: ReactNode;
}) {
	return <section className="mission-dashboard-card">
		<header className="mission-dashboard-card-head">
			<h3><Icon size={16} aria-hidden="true" />{title}</h3>
			{action}
		</header>
		{children}
	</section>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: ReactNode; icon: LucideIcon }) {
	return <div className="mission-dashboard-metric">
		<dt><Icon size={15} aria-hidden="true" />{label}</dt>
		<dd>{value}</dd>
	</div>;
}

function EmptyState({ heading, message, icon: Icon, action, onAction }: {
	heading: string;
	message: string;
	icon: LucideIcon;
	action?: string;
	onAction?: () => void;
}) {
	return <div className="mission-dashboard-empty">
		<span className="mission-dashboard-empty-icon"><Icon size={25} aria-hidden="true" /></span>
		<strong>{heading}</strong>
		<p>{message}</p>
		{action && <button type="button" className="mission-dashboard-button" onClick={onAction}>{action}<ChevronRight size={14} aria-hidden="true" /></button>}
	</div>;
}

const standbyStatuses = new Set(['待命', '待释放', '已暂停']);
const targetFilters = [
	{ id: 'all', label: '全部' },
	{ id: 'pending', label: '待复核' },
	{ id: 'verified', label: '已复核' },
] as const;

export function MissionExecutionPanel({ result, cooperation, assignmentReady, error, onToggle, onOpenOverview }: {
	result: ScanResult | null;
	cooperation: CooperationSimulation;
	assignmentReady: boolean;
	error: string | null;
	onToggle: () => void;
	onOpenOverview: () => void;
}) {
	if (!result) return <div className="mission-dashboard">
		<EmptyState heading="暂无执行任务" message="先在海域态势生成扫描航迹。" icon={Activity} action="前往海域态势" onAction={onOpenOverview} />
	</div>;

	const { fleet, running, second } = cooperation;
	const assets = simulationAssets(result, cooperation);
	const progress = simulatedCoverage(cooperation);
	const finished = fleet ? fleetFinished(fleet) : cooperation.usvProgress >= 1
		&& (cooperation.uavOffline ? cooperation.rescueProgress >= 1 : cooperation.uavProgress >= 1)
		&& cooperation.targetStatus !== 'suspected';
	const status = running ? '执行中' : finished ? '已完成' : second > 0 ? '已暂停' : '待执行';
	const needsAssignment = Boolean(fleet && !fleet.assigned);
	const assignmentPending = Boolean(fleet?.assigned && !assignmentReady);
	const events = [
		...cooperation.events.map((event) => ({ ...event, key: `simulation-${event.id}` })),
		...(fleet?.events ?? []).map((event) => ({ ...event, key: `fleet-${event.id}` })),
	].sort((a, b) => b.second - a.second).slice(0, 8);

	return <div className="mission-dashboard">
		<section className="mission-dashboard-card mission-execution-lead">
			<header className="mission-dashboard-card-head">
				<h3><Activity size={16} aria-hidden="true" />航迹执行</h3>
				<span className="mission-dashboard-status" data-tone={running || finished ? 'green' : 'muted'}>{status} · 仿真</span>
			</header>
			<div className="mission-execution-progress">
				<div><span>整体进度</span><strong>{progress}<small>%</small></strong></div>
				<div className="mission-dashboard-track" role="progressbar" aria-label="仿真航迹执行进度" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
					<span style={{ width: `${progress}%` }} />
				</div>
			</div>
			<div className="mission-execution-footer">
				<span><Clock3 size={15} aria-hidden="true" />仿真耗时 <strong>{formatMissionElapsed(second)}</strong></span>
				{needsAssignment ? (
					<button type="button" className="mission-dashboard-button" onClick={onOpenOverview}>前往分配<ChevronRight size={14} aria-hidden="true" /></button>
				) : (
					<button type="button" className="mission-dashboard-button" disabled={assignmentPending} onClick={onToggle}>
						{running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
						{assignmentPending ? error ? '协同初始化失败' : '正在准备协同' : running ? '暂停仿真' : finished ? '重播仿真' : second > 0 ? '继续仿真' : '开始仿真'}
					</button>
				)}
			</div>
			{error && <p className="mission-dashboard-error" role="status">{error}</p>}
		</section>
		<div className="mission-dashboard-split">
			<Card title="平台状态" icon={ScanLine}>
				<ul className="mission-dashboard-rows mission-execution-assets">
					{assets.map((asset) => <li key={asset.id}>
						<span className="mission-dashboard-row-icon">
							{asset.kind === 'usv' ? <UsvIcon width={18} height={18} /> : <UavIcon width={18} height={18} />}
						</span>
						<div className="mission-dashboard-row-copy"><strong>{asset.id}</strong><small>{asset.assignment}</small></div>
						<span className="mission-dashboard-status" data-tone={asset.status === '失联' ? 'red' : standbyStatuses.has(asset.status) ? 'muted' : 'green'}>{asset.status}</span>
					</li>)}
				</ul>
			</Card>
			<Card title="最近事件" icon={List}>
				{events.length ? <ol className="mission-dashboard-rows mission-execution-events">
					{events.map((event) => <li key={event.key}>
						<span className="mission-dashboard-event-dot" aria-hidden="true" />
						<span>{event.text}</span>
						<time>{formatMissionElapsed(event.second)}</time>
					</li>)}
				</ol> : <p className="mission-dashboard-hint">仿真启动后，任务事件会显示在这里。</p>}
			</Card>
		</div>
	</div>;
}

export function MissionAnalysisPanel({ result, speedKnots, onOpenOverview }: {
	result: ScanResult | null;
	speedKnots: number;
	onOpenOverview: () => void;
}) {
	if (!result) return <div className="mission-dashboard">
		<EmptyState heading="暂无规划数据" message="生成航迹后，可查看覆盖率、航程和各艇分区。" icon={BarChart3} action="前往海域态势" onAction={onOpenOverview} />
	</div>;

	const routes = result.routes?.length ? result.routes : [{
		vessel_id: '规划航迹',
		path_length_m: result.path_length_m,
		waypoint_count: result.waypoint_count,
	}];
	const maxDistance = Math.max(...routes.map((route) => route.path_length_m), 1);

	return <div className="mission-dashboard">
		<dl className="mission-dashboard-metrics">
			<Metric label="规划覆盖率" value={`${result.planned_coverage_percent.toFixed(1)}%`} icon={ScanLine} />
			<Metric label="规划总航程" value={`${(result.path_length_m / 1000).toFixed(1)} km`} icon={Route} />
			<Metric label="预计耗时" value={formatPlannedScanDuration(result, speedKnots)} icon={Clock3} />
			<Metric label="规划航点" value={result.waypoint_count} icon={MapPin} />
		</dl>
		<Card title="各艇规划航程" icon={BarChart3} action={<span className="mission-dashboard-caption">按 {speedKnots} 节估算耗时</span>}>
			<ul className="mission-dashboard-rows mission-analysis-routes">
				{routes.map((route, index) => <li key={route.vessel_id}>
					<span className="mission-analysis-route-name">{route.vessel_id}</span>
					<span className="mission-dashboard-track" aria-hidden="true"><span style={{
						width: `${route.path_length_m / maxDistance * 100}%`,
						background: SCAN_ROUTE_COLORS[index % SCAN_ROUTE_COLORS.length],
					}} /></span>
					<strong>{(route.path_length_m / 1000).toFixed(1)} km</strong>
					<small>{route.waypoint_count} 航点</small>
				</li>)}
			</ul>
		</Card>
	</div>;
}

export function MissionTargetsPanel({ result, cooperation, onLocate }: {
	result: ScanResult | null;
	cooperation: CooperationSimulation;
	onLocate: (id: string, point: FleetPoint) => void;
}) {
	const [filter, setFilter] = useState<(typeof targetFilters)[number]['id']>('all');
	const observations = result ? cooperation.fleet?.observations ?? [] : [];
	const legacyTarget = result && cooperation.target;
	const targets = observations.length > 0 ? observations.map((item) => ({
		id: item.id,
		position: item.position,
		source: item.sourceId,
		observedAt: item.observedAt,
		verified: Boolean(item.verifiedBy),
		verifiedBy: item.verifiedBy,
	})) : legacyTarget ? [{
		id: 'latest',
		position: legacyTarget,
		source: '协同仿真',
		observedAt: null,
		verified: cooperation.targetStatus === 'confirmed',
		verifiedBy: null,
	}] : [];
	const verified = targets.filter((target) => target.verified).length;
	const visible = targets.filter((target) => filter === 'all' || (filter === 'verified' ? target.verified : !target.verified));

	return <div className="mission-dashboard">
		<dl className="mission-dashboard-metrics mission-target-metrics">
			<Metric label="训练目标" value={targets.length} icon={Target} />
			<Metric label="待复核" value={targets.length - verified} icon={Crosshair} />
			<Metric label="已复核" value={verified} icon={CheckCircle2} />
		</dl>
		<Card title="目标记录" icon={List} action={<span className="mission-dashboard-status" data-tone="muted">仿真</span>}>
			<div className="mission-dashboard-filters" role="group" aria-label="按复核状态筛选">
				{targetFilters.map(({ id, label }) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
			</div>
			{visible.length ? <ul className="mission-dashboard-rows mission-target-rows">
				{visible.map((target) => <li key={target.id}>
					<span className="mission-dashboard-row-icon"><Crosshair size={18} aria-hidden="true" /></span>
					<div className="mission-dashboard-row-copy">
						<strong title={target.id === 'latest' ? undefined : target.id}>{target.id === 'latest' ? '训练目标' : `训练目标 ${target.id.slice(0, 8)}`}</strong>
						<small>{target.source}{target.observedAt ? ` · ${formatMissionDateTime(target.observedAt)}` : ''}</small>
						{target.verifiedBy && <small>复核平台 {target.verifiedBy}</small>}
					</div>
					<span className="mission-dashboard-status" data-tone={target.verified ? 'green' : 'gold'}>{target.verified ? '已复核' : '待复核'}</span>
					<button type="button" className="mission-dashboard-button" onClick={() => onLocate(target.id, target.position)}><MapPin size={14} aria-hidden="true" />地图定位</button>
				</li>)}
			</ul> : <EmptyState heading={targets.length ? `暂无${filter === 'verified' ? '已复核' : '待复核'}目标` : '暂无训练目标'} message={targets.length ? '切换筛选条件可查看其他记录。' : '协同仿真上报的目标会出现在这里。'} icon={Crosshair} />}
		</Card>
	</div>;
}
