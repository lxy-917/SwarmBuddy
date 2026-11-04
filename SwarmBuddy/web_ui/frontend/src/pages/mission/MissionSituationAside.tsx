import { Crosshair, Pause, Play, RotateCcw, Target, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { injectSimulatedTarget, pauseSimulation, simulateLinkLoss, simulatedCoverage, simulationAssets, simulationInitial, simulationRiskAreas, startSimulation } from './missionCooperationSimulation';
import { UavIcon, UsvIcon } from './MissionPlatformIcons';
import type { CooperationSimulation, SimulationPoint } from './missionCooperationSimulation';
import type { ScanResult } from '@/api/missionScan';

export function MissionSituationClock() {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(new Date()), 1000);
		return () => window.clearInterval(timer);
	}, []);
	return <time dateTime={now.toISOString()}>{now.toLocaleString('sv-SE', { hour12: false })}</time>;
}

function radarPosition(origin: SimulationPoint, location: SimulationPoint, extent: number) {
	// 仿真雷达只呈现任务相对位置，不代表真实雷达传感器回波。
	return { left: `${Math.max(6, Math.min(94, 50 + (location[0] - origin[0]) / extent * 42))}%`, top: `${Math.max(6, Math.min(94, 50 + (location[1] - origin[1]) / extent * 42))}%` };
}

export function MissionSituationAside({ result, cooperation, onChange }: {
	result: ScanResult | null;
	cooperation: CooperationSimulation;
	onChange: Dispatch<SetStateAction<CooperationSimulation>>;
}) {
	const assets = result ? simulationAssets(result, cooperation) : [];
	const usv = assets.find((asset) => asset.id === 'USV-01');
	const riskAreas = result ? simulationRiskAreas(result) : [];
	const regionVertices = result?.map.region.flat() ?? [];
	let radarExtent = 1;
	for (const [x, y] of regionVertices) radarExtent = Math.max(radarExtent, Math.abs(x - (usv?.position[0] ?? 0)), Math.abs(y - (usv?.position[1] ?? 0)));
	const active = cooperation.second > 0 || cooperation.running;
	const finished = cooperation.usvProgress >= 1 && (cooperation.uavOffline ? cooperation.rescueProgress >= 1 : cooperation.uavProgress >= 1) && cooperation.targetStatus !== 'suspected';
	return <aside id="mission-situation-aside" className="mission-situation-aside mission-overview-aside" aria-label="协同仿真态势">
		<section className="mission-situation-widget mission-radar-widget">
			<header><h3>雷达视图</h3><span>态势仿真</span></header>
			<div className="mission-radar-display" role="img" aria-label={active ? '以无人艇为中心的仿真相对位置' : '启动仿真后显示平台相对位置'}>
				<div className="mission-radar-ring mission-radar-ring-outer" />
				<div className="mission-radar-ring mission-radar-ring-middle" />
				<div className="mission-radar-ring mission-radar-ring-inner" />
				<div className="mission-radar-ticks" />
				<div className={`mission-radar-sweep ${cooperation.running ? 'running' : ''}`} />
				<Crosshair size={22} className="mission-radar-center" aria-hidden="true" />
				{riskAreas.map((area) => <span key={area.id} className="mission-radar-risk" style={radarPosition(usv?.position ?? [500, 312], area.center, radarExtent)} title="高风险区域" />)}
				{active && usv && assets.filter((asset) => asset.id !== 'USV-01').map((asset) => <span key={asset.id} className={`mission-radar-contact ${asset.kind}`} style={radarPosition(usv.position, asset.position, radarExtent)} title={`${asset.id} 位置`}>{asset.kind === 'uav' ? <UavIcon width={12} height={12} /> : <UsvIcon width={12} height={12} />}</span>)}
				{active && usv && cooperation.target && <span className="mission-radar-contact target" style={radarPosition(usv.position, cooperation.target, radarExtent)} title="训练目标仿真位置"><Target size={12} /></span>}
			</div>
		</section>
		<section className="mission-situation-widget mission-assets-widget">
			<header><h3>协同任务</h3><span>{result ? '六平台 · 加速仿真' : '等待扫描规划'}</span></header>
			{result && <div className="mission-sim-controls">
				<button type="button" onClick={() => onChange(cooperation.running ? pauseSimulation : startSimulation)}>{cooperation.running ? <Pause size={12} /> : <Play size={12} />}{cooperation.running ? '暂停' : finished ? '重播' : cooperation.second ? '继续' : '开始'}</button>
				<button type="button" onClick={() => onChange(simulationInitial())} aria-label="重置协同仿真"><RotateCcw size={12} /></button>
				<button type="button" disabled={!cooperation.running || cooperation.uavOffline || cooperation.uavProgress >= 1} onClick={() => onChange(simulateLinkLoss)} title="模拟无人机失联并将剩余区域交给无人艇"><WifiOff size={12} /></button>
				<button type="button" disabled={!cooperation.running || !!cooperation.target} onClick={() => onChange((current) => injectSimulatedTarget(current, result.map.waypoints))} title="投放训练用疑似目标"><Target size={12} /></button>
			</div>}
			{assets.map((asset) => <div className="mission-sim-asset" key={asset.id} title={`${asset.assignment}；仿真进度 ${Math.round(asset.progress * 100)}%`}>
				<div className="mission-asset-row">{asset.kind === 'uav' ? <UavIcon width={15} height={15} /> : <UsvIcon width={15} height={15} />}
					<span>{asset.id}</span><em>{asset.status} {Math.round(asset.progress * 100)}%</em>
				</div><small>{asset.assignment}</small>
			</div>)}
			{active && <div className="mission-sim-coverage">航迹执行 {simulatedCoverage(cooperation)}% · 第 {cooperation.second} 秒</div>}
		</section>
		<section className="mission-situation-widget mission-target-widget">
			<header><h3>目标与事件</h3><span>仿真记录</span></header>
			<div className="mission-sim-target">训练目标：{cooperation.targetStatus === 'none' ? '未投放' : cooperation.targetStatus === 'suspected' ? '疑似 · 待 USV 复核' : '已复核（仿真）'}</div>
			<div className="mission-sim-events" aria-live="polite">{cooperation.events.length ? cooperation.events.slice(0, 3).map((event) => <div key={event.id}><span>{String(Math.floor(event.second / 60)).padStart(2, '0')}:{String(event.second % 60).padStart(2, '0')}</span>{event.text}</div>) : <p>开始仿真后显示任务事件。</p>}</div>
		</section>
	</aside>;
}
