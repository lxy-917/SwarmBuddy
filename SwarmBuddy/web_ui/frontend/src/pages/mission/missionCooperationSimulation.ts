import { advanceFleet, assignFleetRoutes, fleetFinished, fleetInitial, fleetProgress } from './missionFleet';
import type { FleetState } from './missionFleet';
import type { ScanResult } from '@/api/missionScan';

export type SimulationPoint = [number, number];
export type SimulationAsset = {
	id: string;
	kind: 'uav' | 'usv';
	position: SimulationPoint;
	progress: number;
	status: '待命' | '搜索中' | '转场中' | '复核中' | '失联' | '已完成' | '悬停中' | '返航中' | '待释放' | '已暂停';
	assignment: string;
	battery?: number;
};
export type SimulationEvent = { id: number; second: number; text: string };
export type SimulationRiskArea = { id: string; center: SimulationPoint; polygon: SimulationPoint[] };
export type CooperationSimulation = {
	second: number;
	running: boolean;
	uavProgress: number;
	usvProgress: number;
	transferProgress: number;
	rescueProgress: number;
	uavOffline: boolean;
	target: SimulationPoint | null;
	targetProgress: number | null;
	targetStatus: 'none' | 'suspected' | 'confirmed';
	verifyProgress: number;
	events: SimulationEvent[];
	fleet?: FleetState;
};

const cap = (value: number) => Math.max(0, Math.min(1, value));
const point = (value: number[]): SimulationPoint => [value[0], value[1]];
const KNOT_TO_METERS_PER_SECOND = 1852 / 3600;
const DEMO_UAV_SPEED_METERS_PER_SECOND = 12;

export function formatMissionElapsed(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60].map((value) => String(value).padStart(2, '0')).join(':');
}

function plannedDistances(result: ScanResult): { usvMeters: number; uavMeters: number } {
	const routeLengths = result.routes?.map((route) => route.path_length_m).filter((value) => Number.isFinite(value) && value > 0) ?? [];
	const totalMeters = Number.isFinite(result.path_length_m) && result.path_length_m > 0 ? result.path_length_m : 1;
	if (routeLengths.length) {
		const longest = Math.max(...routeLengths);
		return { usvMeters: longest, uavMeters: longest };
	}
	const waypoints = result.map.waypoints;
	const split = routeSplit(waypoints);
	let first = 0;
	let full = 0;
	for (let index = 1; index < waypoints.length; index++) {
		const segment = length(waypoints[index - 1], waypoints[index]);
		full += segment;
		if (index <= split) first += segment;
	}
	const fraction = full > 0 ? first / full : .5;
	return { usvMeters: Math.max(1, totalMeters * (1 - fraction)), uavMeters: Math.max(1, totalMeters * fraction) };
}

export function simulationInitial(result?: ScanResult | null): CooperationSimulation {
	return { second: 0, running: false, uavProgress: 0, usvProgress: 0, transferProgress: 0, rescueProgress: 0, uavOffline: false, target: null, targetProgress: null, targetStatus: 'none', verifyProgress: 0, events: [], ...(result ? { fleet: fleetInitial(result) } : {}) };
}

function length(a: number[], b: number[]) {
	return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function routePoint(route: number[][], start: number, end: number, progress: number): SimulationPoint {
	if (!route.length) return [500, 312];
	const from = Math.max(0, Math.min(route.length - 1, start));
	const to = Math.max(from, Math.min(route.length - 1, end));
	if (from === to) return point(route[from]);
	let total = 0;
	for (let index = from + 1; index <= to; index++) total += length(route[index - 1], route[index]);
	let remaining = total * cap(progress);
	for (let index = from + 1; index <= to; index++) {
		const segment = length(route[index - 1], route[index]);
		if (remaining <= segment || index === to) {
			const ratio = segment ? cap(remaining / segment) : 0;
			return [route[index - 1][0] + (route[index][0] - route[index - 1][0]) * ratio, route[index - 1][1] + (route[index][1] - route[index - 1][1]) * ratio];
		}
		remaining -= segment;
	}
	return point(route[to]);
}

export function routePrefix(route: number[][], progress: number): number[][] {
	if (!route.length) return [];
	if (progress <= 0) return [route[0]];
	if (progress >= 1) return route;
	let total = 0;
	for (let index = 1; index < route.length; index++) total += length(route[index - 1], route[index]);
	let remaining = total * cap(progress);
	const prefix = [route[0]];
	for (let index = 1; index < route.length; index++) {
		const segment = length(route[index - 1], route[index]);
		if (remaining >= segment) { prefix.push(route[index]); remaining -= segment; continue; }
		const ratio = segment ? remaining / segment : 0;
		prefix.push([route[index - 1][0] + (route[index][0] - route[index - 1][0]) * ratio,
			route[index - 1][1] + (route[index][1] - route[index - 1][1]) * ratio]);
		break;
	}
	return prefix;
}

export function routeSplit(route: number[][]) {
	if (route.length < 2) return 0;
	let total = 0;
	for (let index = 1; index < route.length; index++) total += length(route[index - 1], route[index]);
	let traversed = 0;
	for (let index = 1; index < route.length; index++) {
		traversed += length(route[index - 1], route[index]);
		if (traversed >= total / 2) return index;
	}
	return Math.floor(route.length / 2);
}

// 训练用风险区只服务于态势演示，不参与真实航线规划或风险判定。
export function simulationRiskAreas(result: ScanResult): SimulationRiskArea[] {
	const route = result.map.waypoints;
	const vertices = result.map.region.flat();
	if (route.length < 2 || !vertices.length) return [];
	let west = Infinity;
	let east = -Infinity;
	let north = Infinity;
	let south = -Infinity;
	for (const [x, y] of vertices) {
		west = Math.min(west, x);
		east = Math.max(east, x);
		north = Math.min(north, y);
		south = Math.max(south, y);
	}
	const radius = Math.max(22, Math.min(55, Math.min(east - west, south - north) * 0.13));
	return [0.3, 0.72].map((progress, index) => {
		const anchor = routePoint(route, 0, route.length - 1, progress);
		const x = Math.max(west + radius, Math.min(east - radius, anchor[0]));
		const y = Math.max(north + radius, Math.min(south - radius, anchor[1] + (index ? radius * 1.25 : -radius * 1.25)));
		return {
			id: `simulation-risk-${index + 1}`,
			center: [x, y] as SimulationPoint,
			polygon: [[-1.2, -0.15], [-0.75, -0.9], [0.2, -1.05], [1.1, -0.55], [1.3, 0.4], [0.65, 1.05], [-0.55, 0.9], [-1.25, 0.35]].map(([dx, dy]) => [x + dx * radius, y + dy * radius] as SimulationPoint),
		};
	});
}

function addEvent(state: CooperationSimulation, text: string): CooperationSimulation {
	const second = Math.floor(state.second);
	return { ...state, events: [{ id: second * 10 + state.events.length, second, text }, ...state.events].slice(0, 12) };
}

export function startSimulation(state: CooperationSimulation, result?: ScanResult | null): CooperationSimulation {
	if (state.running) return state;
	if (state.fleet) {
		if (!state.fleet.assigned) return state;
		if (fleetFinished(state.fleet) && result) {
			const initial = fleetInitial(result);
			const selected = { ...initial, selectedIds: state.fleet.selectedIds };
			return { ...simulationInitial(result), running: true, fleet: assignFleetRoutes(selected, result, 0) };
		}
		return { ...state, running: true, fleet: { ...state.fleet, events: [{ id: Date.now(), second: Math.floor(state.second), text: state.second ? '继续执行扫描任务' : '开始执行扫描任务' }, ...state.fleet.events] } };
	}
	const finished = state.usvProgress >= 1 && (state.uavOffline ? state.rescueProgress >= 1 : state.uavProgress >= 1) && state.targetStatus !== 'suspected';
	if (finished) return addEvent({ ...simulationInitial(), running: true }, '协同仿真重新开始');
	return addEvent({ ...state, running: true }, state.second ? '继续协同仿真' : '仿真开始：UAV-01 与 USV-01 分区搜索');
}

export function pauseSimulation(state: CooperationSimulation): CooperationSimulation {
	return state.running ? addEvent({ ...state, running: false }, '协同仿真已暂停') : state;
}

export function simulateLinkLoss(state: CooperationSimulation): CooperationSimulation {
	if (!state.running || state.uavOffline || state.uavProgress >= 1) return state;
	return addEvent({ ...state, uavOffline: true }, 'UAV-01 模拟失联；未完成区域已转交 USV-01');
}

export function injectSimulatedTarget(state: CooperationSimulation, route: number[][]): CooperationSimulation {
	if (!state.running || state.target || !route.length) return state;
	const split = routeSplit(route);
	const targetProgress = Math.max(0.12, state.uavProgress);
	const target = routePoint(route, 0, split, targetProgress);
	return addEvent({ ...state, target, targetProgress, targetStatus: 'suspected' }, '训练目标已投放：待 USV-01 复核');
}

export function advanceSimulation(state: CooperationSimulation, elapsedSeconds: number, result: ScanResult, speedKnots: number): CooperationSimulation {
	if (!state.running || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return state;
	if (state.fleet) {
		const second = state.second + elapsedSeconds;
		const fleet = advanceFleet(state.fleet, elapsedSeconds, speedKnots, result, second, state.fleet.agentCoordination ? null : state.target);
		const targetConfirmed = state.target && fleet.observations.some((observation) => observation.verifiedBy && Math.hypot(observation.position[0] - state.target![0], observation.position[1] - state.target![1]) < 10);
		const finished = fleetFinished(fleet);
		const events = finished ? [{ id: Date.now(), second: Math.floor(second), text: '协同任务完成，所有 UAV 已在母艇' }, ...fleet.events] : fleet.events;
		return { ...state, second, fleet: finished ? { ...fleet, events } : fleet, targetStatus: targetConfirmed ? 'confirmed' : state.targetStatus, usvProgress: fleetProgress(fleet) / 100, uavProgress: fleet.drones.length ? fleet.drones.filter((drone) => drone.mode === 'deck').length / fleet.drones.length : 0, running: !finished };
	}
	const { usvMeters, uavMeters } = plannedDistances(result);
	const usvSpeed = Number.isFinite(speedKnots) && speedKnots > 0 ? speedKnots * KNOT_TO_METERS_PER_SECOND : 0;
	const remainingUavMeters = uavMeters * (1 - state.uavProgress);
	const transferMeters = usvMeters + remainingUavMeters;
	const verificationMeters = (state.uavOffline ? 0 : usvMeters) + uavMeters * (1 - (state.targetProgress ?? 0));
	const next: CooperationSimulation = {
		...state,
		second: state.second + elapsedSeconds,
		uavProgress: state.uavOffline ? state.uavProgress : cap(state.uavProgress + DEMO_UAV_SPEED_METERS_PER_SECOND * elapsedSeconds / uavMeters),
		usvProgress: cap(state.usvProgress + usvSpeed * elapsedSeconds / usvMeters),
		transferProgress: state.uavOffline && state.usvProgress >= 1 ? cap(state.transferProgress + usvSpeed * elapsedSeconds / Math.max(transferMeters, 1)) : state.transferProgress,
		rescueProgress: state.uavOffline && state.transferProgress >= 1 ? cap(state.rescueProgress + usvSpeed * elapsedSeconds / Math.max(remainingUavMeters, 1)) : state.rescueProgress,
		verifyProgress: state.targetStatus === 'suspected' && state.usvProgress >= 1 && (!state.uavOffline || state.rescueProgress >= 1) ? cap(state.verifyProgress + usvSpeed * elapsedSeconds / Math.max(verificationMeters, 1)) : state.verifyProgress,
	};
	if (state.usvProgress < 1 && next.usvProgress >= 1) return addEvent(next, 'USV-01 完成原分区搜索');
	if (state.uavOffline && state.transferProgress < 1 && next.transferProgress >= 1) return addEvent(next, 'USV-01 完成接替转场，开始搜索剩余区域');
	if (!state.uavOffline && state.uavProgress < 1 && next.uavProgress >= 1) return addEvent(next, 'UAV-01 完成分区搜索');
	if (state.uavOffline && state.rescueProgress < 1 && next.rescueProgress >= 1) return addEvent(next, 'USV-01 完成失联区域接替搜索');
	if (state.targetStatus === 'suspected' && next.verifyProgress >= 1) return addEvent({ ...next, targetStatus: 'confirmed' }, '训练目标复核完成（仿真）');
	const searchDone = next.usvProgress >= 1 && (next.uavOffline ? next.rescueProgress >= 1 : next.uavProgress >= 1);
	if (searchDone && (next.targetStatus !== 'suspected' || next.verifyProgress >= 1)) return addEvent({ ...next, running: false }, '协同仿真完成');
	return next;
}

export function simulationAssets(result: ScanResult, state: CooperationSimulation): SimulationAsset[] {
	if (state.fleet) {
		return [
			...state.fleet.boats.map((boat): SimulationAsset => ({ id: boat.id, kind: 'usv', position: boat.position, progress: boat.progress, battery: boat.battery, status: ({ idle: '待命', scan: state.running ? '搜索中' : '已暂停', paused: '已暂停', verify: '复核中', resume: '转场中', done: '已完成' } as const)[boat.mode], assignment: boat.routeIds.length ? `扫描航线 ${boat.routeIds.join('、')}` : '未分配任务' })),
			...state.fleet.drones.map((drone): SimulationAsset => ({ id: drone.id, kind: 'uav', position: drone.position, progress: drone.mode === 'deck' ? 0 : 0.5, battery: drone.battery, status: ({ deck: '待释放', auto: '搜索中', manual: '转场中', hover: '悬停中', return: '返航中' } as const)[drone.mode], assignment: `搭载于 ${drone.carrierId}` })),
		];
	}
	const route = result.map.waypoints;
	if (result.map.routes?.length) {
		const routeMeters = (item: { vessel_id: string; waypoints: number[][] }) => result.routes?.find((route) => route.vessel_id === item.vessel_id)?.path_length_m
			?? item.waypoints.slice(1).reduce((total, next, index) => total + length(item.waypoints[index], next), 0);
		const longest = Math.max(...result.map.routes.map(routeMeters), 1);
		const boats: SimulationAsset[] = result.map.routes.map((item, index) => {
			const distance = routeMeters(item);
			const progress = cap(state.usvProgress * longest / Math.max(distance, 1));
			return { id: item.vessel_id, kind: 'usv', position: routePoint(item.waypoints, 0, item.waypoints.length - 1, progress), progress,
				status: (progress >= 1 ? '已完成' : state.running ? '搜索中' : '待命') as SimulationAsset['status'], assignment: `DARP 分区 ${index + 1}` };
		});
		const drones: SimulationAsset[] = result.map.routes.map((item, index) => {
			const progress = state.uavProgress;
			return { id: `UAV-${String(index + 1).padStart(2, '0')}`, kind: 'uav', position: routePoint(item.waypoints, 0, item.waypoints.length - 1, progress), progress,
				status: (state.uavOffline && index === 0 ? '失联' : progress >= 1 ? '已完成' : state.running ? '搜索中' : '待命') as SimulationAsset['status'], assignment: '无人机演示航迹' };
		});
		return [...boats, ...drones];
	}
	const split = routeSplit(route);
	const uavPosition = routePoint(route, 0, split, state.uavProgress);
	let firstLength = 0;
	let totalLength = 0;
	for (let index = 1; index < route.length; index++) {
		const segment = length(route[index - 1], route[index]);
		totalLength += segment;
		if (index <= split) firstLength += segment;
	}
	const splitFraction = totalLength ? firstLength / totalLength : 0;
	const transferDestination = state.uavProgress * splitFraction;
	const usvPosition = state.uavOffline && state.usvProgress >= 1
		? state.transferProgress < 1
			? routePoint(route, 0, route.length - 1, 1 - (1 - transferDestination) * state.transferProgress)
			: routePoint(route, 0, split, state.uavProgress + (1 - state.uavProgress) * state.rescueProgress)
		: routePoint(route, split, route.length - 1, state.usvProgress);
	const verificationPosition: SimulationPoint = state.target && state.verifyProgress > 0
		? routePoint(route, 0, route.length - 1, (state.uavOffline ? splitFraction : 1) + ((state.targetProgress ?? 0) * splitFraction - (state.uavOffline ? splitFraction : 1)) * state.verifyProgress)
		: usvPosition;
	return [
		{ id: 'UAV-01', kind: 'uav', position: uavPosition, progress: state.uavProgress, status: state.uavOffline ? '失联' : state.uavProgress >= 1 ? '已完成' : state.running ? '搜索中' : '待命', assignment: '前半区广域搜索' },
		{ id: 'USV-01', kind: 'usv', position: verificationPosition, progress: state.uavOffline ? (state.usvProgress + state.rescueProgress) / 2 : state.usvProgress, status: state.verifyProgress > 0 && state.verifyProgress < 1 ? '复核中' : state.uavOffline && state.usvProgress >= 1 && state.transferProgress < 1 ? '转场中' : state.usvProgress >= 1 && (!state.uavOffline || state.rescueProgress >= 1) && state.targetStatus !== 'suspected' ? '已完成' : state.running ? '搜索中' : '待命', assignment: state.uavOffline ? '后半区搜索 + 接替 UAV' : '后半区重点搜索' },
	];
}

export function simulatedCoverage(state: CooperationSimulation) {
	if (state.fleet) return fleetProgress(state.fleet);
	return Math.round((state.uavOffline ? state.uavProgress + (1 - state.uavProgress) * state.rescueProgress : state.uavProgress) * 50 + state.usvProgress * 50);
}
