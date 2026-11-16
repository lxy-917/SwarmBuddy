import { ChevronRight, Expand, Pause, Play, RotateCcw, Target, WifiOff, X } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { formatMissionElapsed, injectSimulatedTarget, simulateLinkLoss, simulatedCoverage, simulationAssets, simulationInitial } from './missionCooperationSimulation';
import type { CooperationSimulation } from './missionCooperationSimulation';
import { assignFleetRoutes, fleetFinished, selectFleetBoat } from './missionFleet';
import type { FleetUav, FleetUavCommand, FleetPoint } from './missionFleet';
import { UavIcon, UsvIcon } from './MissionPlatformIcons';
import { MissionRadarCanvas } from './MissionRadarCanvas';
import type { MissionTaskAssignment, MissionTaskEvent, ScanResult } from '@/api/missionScan';

const taskEventNames: Record<string, string> = {
	UAV_RELEASED: '无人机放飞', TARGET_SUSPECTED: '报告训练目标',
	VERIFY_REQUESTED: '申请复核', VERIFY_ACCEPTED: '复核获准',
	VERIFY_COMPLETED: '复核完成', MISSION_PAUSED: '任务暂停',
	MISSION_RESUMED: '任务继续', UAV_LOW_BATTERY: '无人机低电量',
	UAV_RETURNING: '无人机返航', UAV_RETURNED: '无人机返艇',
	UAV_TARGET_REQUESTED: '申请目标点', UAV_COMMAND_REQUESTED: '申请飞行模式',
};

function geoPosition(result: ScanResult, position: FleetPoint) {
	const vertices = result.map.region.flat();
	const xs = vertices.map(([x]) => x);
	const ys = vertices.map(([, y]) => y);
	const west = Math.min(...xs);
	const east = Math.max(...xs);
	const north = Math.min(...ys);
	const south = Math.max(...ys);
	const longitude = result.bounds.west + (position[0] - west) / Math.max(1, east - west) * (result.bounds.east - result.bounds.west);
	const latitude = result.bounds.north - (position[1] - north) / Math.max(1, south - north) * (result.bounds.north - result.bounds.south);
	return `${longitude.toFixed(4)}°E，${latitude.toFixed(4)}°N`;
}

function FleetUavControls({ drone, onCommand, onArmMapTarget, onReport, mapTargetArmed, reportDisabled }: {
	drone: FleetUav;
	onCommand: (command: FleetUavCommand, values?: { speedMps?: number; headingDegrees?: number; altitudeM?: number; target?: FleetPoint | null }) => void;
	onArmMapTarget: () => void;
	onReport: () => void;
	mapTargetArmed: boolean;
	reportDisabled: boolean;
}) {
	const [speed, setSpeed] = useState(String(drone.commandedSpeedMps));
	const [heading, setHeading] = useState(String(Math.round(drone.headingDegrees)));
	const [altitude, setAltitude] = useState(String(drone.altitudeM || 50));
	const [showManual, setShowManual] = useState(false);
	const manualValid = Number.isFinite(Number(speed)) && speed.trim() !== '' && Number(speed) >= 0 && Number(speed) <= 30
		&& Number.isFinite(Number(heading)) && heading.trim() !== '' && Number(heading) >= 0 && Number(heading) < 360
		&& Number.isFinite(Number(altitude)) && altitude.trim() !== '' && Number(altitude) >= 10 && Number(altitude) <= 120;
	const sendManual = () => onCommand('manual', { speedMps: Number(speed), headingDegrees: Number(heading), altitudeM: Number(altitude) });
	return <div className="mission-uav-controls">
		<div className="mission-uav-action-row">
			<button type="button" disabled={drone.mode === 'deck'} onClick={() => onCommand('auto')}>自动搜索</button>
			<button type="button" disabled={drone.mode === 'deck'} className={showManual ? 'active' : ''} onClick={() => { setShowManual((value) => !value); onCommand('manual', { speedMps: Number(speed), headingDegrees: Number(heading), altitudeM: Number(altitude) }); }}>手动控制</button>
			<button type="button" disabled={drone.mode === 'deck'} onClick={() => onCommand('return')}>返回母艇</button>
			<button type="button" disabled={drone.mode === 'deck'} onClick={() => onCommand('hover')}>悬停</button>
		</div>
		{showManual && <div className="mission-uav-manual"><div className="mission-uav-fields"><label>目标速度 m/s<input type="number" min="0" max="30" step="0.1" value={speed} onChange={(event) => setSpeed(event.target.value)} /></label><label>航向 °<input type="number" min="0" max="359" step="1" value={heading} onChange={(event) => setHeading(event.target.value)} /></label><label>高度 m<input type="number" min="10" max="120" step="1" value={altitude} onChange={(event) => setAltitude(event.target.value)} /></label></div><div className="mission-uav-action-row"><button type="button" disabled={!manualValid} onClick={sendManual}>发送指令</button><button type="button" disabled={!manualValid} className={mapTargetArmed ? 'active' : ''} onClick={() => { sendManual(); onArmMapTarget(); }}>{mapTargetArmed ? '地图选点中' : '地图选目标点'}</button></div></div>}
		<div className="mission-uav-telemetry"><span>仿真遥测 {drone.speedMps.toFixed(1)} m/s</span><span>{Math.round(drone.headingDegrees)}°</span><span>{Math.round(drone.altitudeM)} m</span><span>模拟电量 {Math.round(drone.battery)}%</span></div>
		<div className="mission-uav-ack">{drone.commandStatus}</div>
		<button type="button" className="mission-uav-report" disabled={drone.mode === 'deck' || reportDisabled} onClick={onReport}>报告训练目标</button>
	</div>;
}

export function MissionSituationClock() {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(new Date()), 1000);
		return () => window.clearInterval(timer);
	}, []);
	return <time dateTime={now.toISOString()}>{now.toLocaleString('sv-SE', { hour12: false })}</time>;
}

export function MissionSituationAside({ result, cooperation, onChange, selectedUsvId, onSelectUsv, onSelectAsset, targetSelected, onSelectTarget, onFocusObservation, manualTargetUavId, onArmManualTarget, taskAssignment, taskEvents, taskEventError, taskEventBusy, onReleaseUav, onReportTarget, onRespondObservation, onCommandUav, onToggleSimulation }: {
	result: ScanResult | null;
	cooperation: CooperationSimulation;
	onChange: Dispatch<SetStateAction<CooperationSimulation>>;
	selectedUsvId: string;
	onSelectUsv: (id: string) => void;
	onSelectAsset?: (kind: 'usv' | 'uav', id: string) => void;
	targetSelected: boolean;
	onSelectTarget: () => void;
	onFocusObservation: (point: FleetPoint) => void;
	manualTargetUavId: string | null;
	onArmManualTarget: (id: string | null) => void;
	taskAssignment: MissionTaskAssignment | null;
	taskEvents: MissionTaskEvent[];
	taskEventError: string | null;
	taskEventBusy: boolean;
	onReleaseUav: (carrierId: string) => void;
	onReportTarget: (droneId: string) => void;
	onRespondObservation: (boatId: string, observationId: string, action: 'pause' | 'verify' | 'continue') => void;
	onCommandUav: (id: string, command: FleetUavCommand, values?: { speedMps?: number; headingDegrees?: number; altitudeM?: number; target?: FleetPoint | null }) => void;
	onToggleSimulation: () => void;
}) {
	const [radarZoom, setRadarZoom] = useState(1);
	const [radarCollapsed, setRadarCollapsed] = useState(false);
	const [assetsCollapsed, setAssetsCollapsed] = useState(false);
	const [assetFilter, setAssetFilter] = useState<'all' | 'uav' | 'usv' | 'other'>('all');
	const [expandedAssetIds, setExpandedAssetIds] = useState<string[]>([]);
	const zoomRadar = (direction: 'in' | 'out') => setRadarZoom((current) => Math.max(.5, Math.min(8, current * (direction === 'in' ? 1.5 : 1 / 1.5))));
	const fleet = cooperation.fleet;
	const assets = result ? simulationAssets(result, cooperation) : [];
	const boats = assets.filter((asset) => asset.kind === 'usv');
	const filteredAssets = assets.filter((asset) => assetFilter === 'all' || asset.kind === assetFilter);
	const selectedBoat = boats.find((asset) => asset.id === selectedUsvId) ?? boats[0];
	const vertices = result?.map.region.flat() ?? [];
	const xs = vertices.map(([x]) => x);
	const ys = vertices.map(([, y]) => y);
	const mapWidth = xs.length ? Math.max(...xs) - Math.min(...xs) : 1;
	const mapHeight = ys.length ? Math.max(...ys) - Math.min(...ys) : 1;
	const midLatitude = result ? (result.bounds.south + result.bounds.north) / 2 : 0;
	const widthMeters = result ? (result.bounds.east - result.bounds.west) * 111_320 * Math.cos(midLatitude * Math.PI / 180) : 1;
	const heightMeters = result ? (result.bounds.north - result.bounds.south) * 111_320 : 1;
	const metersPerUnit = Math.max(widthMeters / Math.max(mapWidth, 1), heightMeters / Math.max(mapHeight, 1));
	const baseRangeMeters = Math.max(500, Math.ceil(Math.hypot(widthMeters, heightMeters) / 500) * 500);
	const rangeMeters = baseRangeMeters / radarZoom;
	const radarTarget = cooperation.target ?? fleet?.observations[0]?.position ?? null;
	const targetDx = radarTarget && selectedBoat ? (radarTarget[0] - selectedBoat.position[0]) * metersPerUnit : 0;
	const targetDy = radarTarget && selectedBoat ? (radarTarget[1] - selectedBoat.position[1]) * metersPerUnit : 0;
	const targetDistance = Math.hypot(targetDx, targetDy);
	const targetBearing = (Math.atan2(targetDx, -targetDy) * 180 / Math.PI + 360) % 360;
	const active = cooperation.second > 0 || cooperation.running;
	const collaborationEvents = taskEvents.filter((event) => event.event_type === 'TARGET_SUSPECTED' || event.event_type.startsWith('VERIFY_'));
	const statusEvents = taskEvents.filter((event) => event.event_type !== 'TARGET_SUSPECTED' && !event.event_type.startsWith('VERIFY_'));
	const finished = fleet ? fleetFinished(fleet) : cooperation.usvProgress >= 1 && (cooperation.uavOffline ? cooperation.rescueProgress >= 1 : cooperation.uavProgress >= 1) && cooperation.targetStatus !== 'suspected';
	const respond = onRespondObservation;
	return <aside id="mission-situation-aside" className={`mission-situation-aside mission-overview-aside ${radarCollapsed ? 'radar-collapsed' : ''} ${assetsCollapsed ? 'assets-collapsed' : ''}`} aria-label="协同仿真态势">
		<section className={`mission-situation-widget mission-radar-widget ${radarCollapsed ? 'is-collapsed' : ''}`}>
			<header><h3>雷达视图</h3><div className="mission-radar-header-controls">{!radarCollapsed && boats.length ? <select className="mission-radar-vessel-select" aria-label="选择雷达中心无人艇" value={selectedBoat?.id} onChange={(event) => onSelectUsv(event.target.value)}>{boats.map((boat) => <option key={boat.id} value={boat.id}>{boat.id}</option>)}</select> : null}<button type="button" className="mission-overlay-toggle mission-radar-toggle" aria-label={radarCollapsed ? '展开雷达视图' : '收起雷达视图'} title={radarCollapsed ? '展开雷达视图' : '收起雷达视图'} aria-expanded={!radarCollapsed} onClick={() => setRadarCollapsed((value) => !value)}>{radarCollapsed ? <Expand size={13} /> : <X size={14} />}</button></div></header>
			{!radarCollapsed && <div className="mission-radar-display">
				<MissionRadarCanvas origin={selectedBoat} contacts={active || fleet?.assigned ? assets.filter((asset) => asset.kind === 'usv' || fleet?.drones.find((drone) => drone.id === asset.id)?.mode !== 'deck') : []} target={active ? radarTarget : null} targetSelected={targetSelected} metersPerUnit={metersPerUnit} rangeMeters={rangeMeters} running={cooperation.running} onSelectUsv={onSelectUsv} onSelectTarget={() => { if (cooperation.target) onSelectTarget(); else if (fleet?.observations[0]) onFocusObservation(fleet.observations[0].position); }} onZoom={zoomRadar} />
				<div className="mission-radar-zoom-controls"><button type="button" aria-label="放大雷达" title="缩小量程" disabled={radarZoom >= 8} onClick={() => zoomRadar('in')}>＋</button><button type="button" aria-label="缩小雷达" title="扩大量程" disabled={radarZoom <= .5} onClick={() => zoomRadar('out')}>－</button></div>
			</div>}
		</section>
		<section className={`mission-situation-widget mission-assets-widget ${assetsCollapsed ? 'is-collapsed' : ''}`}>
			<header><h3>资产列表 <span>({assets.length})</span></h3><div className="mission-assets-header-actions"><button type="button" className="mission-overlay-toggle mission-assets-toggle" aria-label={assetsCollapsed ? '展开资产列表' : '收起资产列表'} title={assetsCollapsed ? '展开资产列表' : '收起资产列表'} aria-expanded={!assetsCollapsed} onClick={() => setAssetsCollapsed((value) => !value)}>{assetsCollapsed ? <Expand size={13} /> : <X size={14} />}</button></div></header>
			{!assetsCollapsed && <><div className="mission-assets-filter" role="group" aria-label="筛选资产类型">{([
				['all', '全部', assets.length],
				['uav', '无人机', assets.filter((asset) => asset.kind === 'uav').length],
				['usv', '无人艇', boats.length],
				['other', '其他', 0],
			] as const).map(([value, label, count]) => <button key={value} type="button" className={assetFilter === value ? 'active' : ''} aria-pressed={assetFilter === value} onClick={() => setAssetFilter(value)}>{label} {count}</button>)}</div>
			{fleet && result && <div className="mission-fleet-assignment"><button type="button" disabled={cooperation.running || fleet.assigned || fleet.selectedIds.length === 0} onClick={() => onChange((current) => current.fleet ? { ...current, running: false, second: 0, fleet: assignFleetRoutes(current.fleet, result, 0) } : current)}>分配扫描任务</button><span>{fleet.assigned ? `${fleet.boats.filter((boat) => boat.route.length).length} 艘艇已分配` : fleet.selectedIds.length === (result.map.routes?.length ?? 1) ? `已勾选 ${fleet.selectedIds.length} 艘艇` : `需勾选 ${result.map.routes?.length ?? 1} 艘艇`}</span></div>}
			<div className="mission-assets-scroll" role="region" aria-label="仿真资产列表" tabIndex={0}>
				{filteredAssets.map((asset) => {
					const boatId = asset.kind === 'usv' ? asset.id : asset.id.replace('UAV-', 'USV-');
					const route = asset.kind === 'usv' ? result?.routes?.find((item) => item.vessel_id === boatId) : undefined;
					const fleetBoat = fleet?.boats.find((item) => item.id === asset.id);
					const fleetDrone = fleet?.drones.find((item) => item.id === asset.id);
					const carrierDrone = fleet?.drones.find((item) => item.carrierId === asset.id);
					const statusTone = asset.status === '失联' ? 'danger' : asset.status === '转场中' || asset.status === '返航中' ? 'warning' : asset.status === '待命' || asset.status === '待释放' || asset.status === '已暂停' ? 'standby' : asset.status === '已完成' ? 'complete' : 'active';
					return <Fragment key={asset.id}><div className="mission-asset-select-row">{fleetBoat && <input type="checkbox" aria-label={`勾选 ${fleetBoat.id} 分配扫描任务`} checked={fleet?.selectedIds.includes(fleetBoat.id) ?? false} disabled={fleet?.assigned || cooperation.running} onChange={() => { onChange((current) => current.fleet ? { ...current, fleet: selectFleetBoat(current.fleet, fleetBoat.id) } : current); setExpandedAssetIds((current) => current.includes(asset.id) ? current : [...current, asset.id]); onSelectUsv(boatId); onSelectAsset?.(asset.kind, asset.id); }} />}<button type="button" className={`mission-sim-asset ${expandedAssetIds.includes(asset.id) ? 'selected' : ''}`} aria-expanded={expandedAssetIds.includes(asset.id)} title={`${asset.assignment}；${fleet ? `剩余电量 ${Math.round(asset.battery ?? 100)}%` : `仿真进度 ${Math.round(asset.progress * 100)}%`}`} onClick={() => { setExpandedAssetIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id]); onSelectUsv(boatId); onSelectAsset?.(asset.kind, asset.id); }}>
						{asset.kind === 'uav' ? <UavIcon width={16} height={16} /> : <UsvIcon width={16} height={16} />}
						<span className="mission-asset-name">{asset.id}</span><i className={`mission-asset-status-dot ${statusTone}`} aria-hidden="true" /><span className="mission-asset-status">{asset.status}</span><strong>{Math.round(fleet ? asset.battery ?? 100 : asset.progress * 100)}%</strong><ChevronRight className="mission-asset-chevron" size={14} />
					</button></div>
					{expandedAssetIds.includes(asset.id) && <div className="mission-asset-detail"><span>位置：{result ? geoPosition(result, asset.position) : '—'}</span><span>任务：{asset.assignment}</span>{fleetBoat && <><span>剩余电量（估算）：{Math.round(fleetBoat.battery)}% · {asset.status}</span><span>可用无人机：{carrierDrone ? `${carrierDrone.id} · ${carrierDrone.mode !== 'deck' ? '飞行中' : carrierDrone.battery < 35 ? '电量不足' : '可释放'}` : '无'}</span>{fleetBoat.route.length > 0 && <span>分配航线：{(fleetBoat.pathMeters / 1000).toFixed(1)} km · 已执行 {Math.round(fleetBoat.progress * 100)}%</span>}{carrierDrone && <button type="button" className="mission-release-uav" disabled={!fleet?.assigned || !taskAssignment || taskEventBusy || !fleetBoat.route.length || carrierDrone.mode !== 'deck' || carrierDrone.battery < 35} onClick={() => onReleaseUav(fleetBoat.id)}>释放 {carrierDrone.id}</button>}</>}{fleetDrone && <><span>母艇：{fleetDrone.carrierId} · 剩余电量（估算）：{Math.round(fleetDrone.battery)}%</span><FleetUavControls drone={fleetDrone} mapTargetArmed={manualTargetUavId === fleetDrone.id} onArmMapTarget={() => onArmManualTarget(manualTargetUavId === fleetDrone.id ? null : fleetDrone.id)} onCommand={(command, values) => onCommandUav(fleetDrone.id, command, values)} onReport={() => onReportTarget(fleetDrone.id)} reportDisabled={!taskAssignment || taskEventBusy} /></>}{!fleet && route && <><span>规划分区面积 {(route.region_area_m2 / 1e6).toFixed(2)} km²</span><span>计划航线长度 {(route.path_length_m / 1000).toFixed(1)} km</span></>}</div>}
				</Fragment>;
				})}
				{filteredAssets.length === 0 && <p className="mission-assets-empty">当前没有此类资产</p>}
			</div>
			{result && <div className="mission-sim-controls">
				<button type="button" disabled={!!fleet && (!fleet.assigned || !taskAssignment)} onClick={onToggleSimulation}>{cooperation.running ? <Pause size={12} /> : <Play size={12} />}{cooperation.running ? '暂停' : finished ? '重播' : cooperation.second ? '继续' : '开始'}</button>
				<button type="button" onClick={() => onChange(simulationInitial(result))} aria-label="重置协同任务"><RotateCcw size={12} /></button>
				{!fleet && <button type="button" disabled={!cooperation.running || cooperation.uavOffline || cooperation.uavProgress >= 1} onClick={() => onChange(simulateLinkLoss)} title="模拟无人机失联并将剩余区域交给无人艇"><WifiOff size={12} /></button>}
				<button type="button" disabled={!cooperation.running || !!cooperation.target || (fleet?.assigned && (!taskAssignment || taskEventBusy || !fleet.drones.some((drone) => drone.mode !== 'deck' && drone.mode !== 'return')))} onClick={() => { if (fleet?.assigned) { const drone = fleet.drones.find((item) => item.mode !== 'deck' && item.mode !== 'return'); if (drone) onReportTarget(drone.id); } else onChange((current) => injectSimulatedTarget(current, result.map.waypoints)); }} title="报告仿真训练目标"><Target size={12} /></button>
			</div>}
			{active && <div className="mission-sim-coverage">仿真航迹进度 {simulatedCoverage(cooperation)}% · {formatMissionElapsed(cooperation.second)}</div>}</>}
		</section>
		<section className="mission-situation-widget mission-target-widget">
			<header><h3>目标与事件</h3></header>
			{fleet?.observations.map((observation) => <article key={observation.id} className="mission-fleet-observation-card">
				<strong>{observation.id} · {observation.verifiedBy ? `已由 ${observation.verifiedBy} 核查` : '待核查'}</strong>
				<span>来源 {observation.sourceId} · {new Date(observation.observedAt).toLocaleString('zh-CN', { hour12: false })}</span>
				<span>位置 {result ? geoPosition(result, observation.position) : '—'}</span>
				<button type="button" className="mission-observation-locate" onClick={() => onFocusObservation(observation.position)}>地图定位</button>
				{observation.receivedBy.length > 0 && <div className="mission-fleet-response-list">{observation.receivedBy.map((boatId) => {
					const boat = fleet.boats.find((item) => item.id === boatId);
					return <div key={boatId}><span>{boatId} 已收到 · {boat?.mode === 'verify' ? '前往核查' : boat?.mode === 'paused' ? '已暂停' : boat?.mode === 'resume' ? '返回航线' : '继续扫描'}</span><div>
						<button type="button" onClick={() => respond(boatId, observation.id, 'pause')}>暂停</button>
						<button type="button" disabled={!!observation.verifiedBy} onClick={() => respond(boatId, observation.id, 'verify')}>前往核查</button>
						<button type="button" onClick={() => respond(boatId, observation.id, 'continue')}>继续扫描</button>
					</div></div>;
				})}</div>}
			</article>)}
			{cooperation.target ? <button type="button" className={`mission-sim-target ${targetSelected ? 'selected' : ''}`} onClick={onSelectTarget} aria-label="定位训练目标">
				<strong>训练目标 · {cooperation.targetStatus === 'suspected' ? '待复核' : '已复核'}</strong>
				<small>距 {selectedBoat?.id ?? '无人艇'} {(targetDistance / 1000).toFixed(2)} km · 方位 {Math.round(targetBearing)}°</small>
			</button> : !fleet?.observations.length && <div className="mission-sim-target">暂无训练观测</div>}
			{fleet?.assigned && <div className="mission-agent-ledger" aria-label="仿真 Agent 事件链">
				<strong>多艇目标协同 · 仿真</strong>
				<p>UAV 报告后，母艇判断，协调 Agent 只通知相关 USV；建议经校验后才改变任务状态。</p>
				{taskEventError && <p className="mission-agent-error" role="status">{taskEventError}</p>}
				{!taskAssignment && !taskEventError && <p>正在建立艇机 Agent 任务…</p>}
				{taskAssignment && collaborationEvents.length === 0 && <p>暂无跨艇目标协同。开始任务并放飞 UAV 后，点击“报告训练目标”。</p>}
				{collaborationEvents.slice(0, 10).map((event) => <article key={event.event_id} className="mission-agent-event">
					<header><span>{event.sender_id} · {taskEventNames[event.event_type] ?? event.event_type}</span><b>{event.status === 'completed' ? '已执行' : event.status === 'rejected' ? '已拒绝' : event.status === 'deferred' ? '已暂缓' : event.status}</b></header>
					<small>接收：{event.recipient_ids.length ? event.recipient_ids.join('、') : '仅协调服务'} · {new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</small>
					{event.event_type === 'TARGET_SUSPECTED' && event.peer_review && <details><summary>协作评议 · {event.peer_review.status === 'completed' ? '已完成' : '未完成'} · 修订 {event.revisions?.length ?? 0} 次</summary>
						<p>{event.peer_review.summary ?? event.peer_review.reason ?? '暂无评议结果'}</p>
						{event.peer_review.findings?.map((finding, index) => <p key={`${event.event_id}-finding-${index}`}>{finding.asset_id}：{finding.concern}（依据：{finding.evidence} = {JSON.stringify(finding.evidence_value)}）</p>)}
						{event.revisions?.map((revision, index) => <p key={`${event.event_id}-revision-${index}`}>{revision.asset_id}：{revision.before.decision} → {revision.after.decision}</p>)}
						{event.assessment && <p>建议 {event.assessment.proposal_count} 条 · 校验拒绝 {event.assessment.validation_rejection_count} 条 · 已执行动作 {event.assessment.executed_action_count} 条；任务成效分数：{event.assessment.outcome_score ?? '暂无可靠数据'}</p>}
					</details>}
					<ol>{event.chain.map((step, index) => <li key={`${event.event_id}-${index}`}><span>{step.actor_id}</span> {step.detail}{step.status !== 'completed' ? `（${step.status}）` : ''}</li>)}</ol>
				</article>)}
				{statusEvents.length > 0 && <details className="mission-agent-status-events"><summary>放飞、返航等单艇状态事件（{statusEvents.length}）</summary>{statusEvents.slice(0, 10).map((event) => <div key={event.event_id}>{event.sender_id} · {taskEventNames[event.event_type] ?? event.event_type} · {event.status === 'completed' ? '已执行' : event.status === 'rejected' ? '已拒绝' : '已暂缓'}</div>)}</details>}
			</div>}
			<div className="mission-sim-events" aria-live="polite">{(fleet?.events ?? cooperation.events).length ? (fleet?.events ?? cooperation.events).slice(0, 5).map((event) => <div key={event.id}><span>{formatMissionElapsed(event.second)}</span>{event.text}</div>) : <p>开始任务后显示事件。</p>}</div>
		</section>
	</aside>;
}
