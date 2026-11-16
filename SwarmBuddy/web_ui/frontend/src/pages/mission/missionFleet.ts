import type { ScanResult } from '@/api/missionScan';

export type FleetPoint = [number, number];
export type FleetBoatMode = 'idle' | 'scan' | 'paused' | 'verify' | 'resume' | 'done';
export type FleetUavMode = 'deck' | 'auto' | 'manual' | 'hover' | 'return';
export type FleetBoat = {
	id: string;
	position: FleetPoint;
	route: FleetPoint[];
	region: number[][][];
	routeIds: string[];
	pathMeters: number;
	progress: number;
	mode: FleetBoatMode;
	battery: number;
	observationId: string | null;
};
export type FleetUav = {
	id: string;
	carrierId: string;
	position: FleetPoint;
	track: FleetPoint[];
	mode: FleetUavMode;
	autoPath: FleetPoint[];
	autoIndex: number;
	target: FleetPoint | null;
	speedMps: number;
	commandedSpeedMps: number;
	headingDegrees: number;
	altitudeM: number;
	battery: number;
	commandStatus: string;
};
export type FleetObservation = {
	id: string;
	position: FleetPoint;
	observedAt: string;
	sourceId: string;
	receivedBy: string[];
	verifiedBy: string | null;
};
export type FleetEvent = { id: number; second: number; text: string };
export type FleetState = {
	assigned: boolean;
	agentCoordination?: boolean;
	assignmentId?: string;
	selectedIds: string[];
	boats: FleetBoat[];
	drones: FleetUav[];
	observations: FleetObservation[];
	events: FleetEvent[];
};

const KNOT_MPS = 1852 / 3600;
const UAV_AUTO_MPS = 12;
const UAV_RETURN_MPS = 12;
const UAV_ENDURANCE_SECONDS = 40 * 60;
const USV_ENDURANCE_SECONDS = 12 * 60 * 60;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const point = (value: number[]): FleetPoint => [value[0], value[1]];
const length = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const scaleCache = new WeakMap<ScanResult, { x: number; y: number }>();

function scale(result: ScanResult) {
	const cached = scaleCache.get(result);
	if (cached) return cached;
	const vertices = result.map.region.flat();
	const xs = vertices.map(([x]) => x);
	const ys = vertices.map(([, y]) => y);
	const latitude = (result.bounds.north + result.bounds.south) / 2;
	const factors = {
		x: Math.abs((result.bounds.east - result.bounds.west) * 111_320 * Math.cos(latitude * Math.PI / 180) / Math.max(1, Math.max(...xs) - Math.min(...xs))),
		y: Math.abs((result.bounds.north - result.bounds.south) * 111_320 / Math.max(1, Math.max(...ys) - Math.min(...ys))),
	};
	scaleCache.set(result, factors);
	return factors;
}

function meters(a: FleetPoint, b: FleetPoint, result: ScanResult) {
	const factor = scale(result);
	return Math.hypot((b[0] - a[0]) * factor.x, (b[1] - a[1]) * factor.y);
}

function routePoint(route: FleetPoint[], progress: number, result?: ScanResult): FleetPoint {
	if (!route.length) return [500, 312];
	const segmentLength = (a: FleetPoint, b: FleetPoint) => result ? meters(a, b, result) : length(a, b);
	const total = route.slice(1).reduce((sum, next, index) => sum + segmentLength(route[index], next), 0);
	let remaining = total * clamp(progress, 0, 1);
	for (let index = 1; index < route.length; index++) {
		const segment = segmentLength(route[index - 1], route[index]);
		if (remaining <= segment || index === route.length - 1) {
			const ratio = segment ? clamp(remaining / segment, 0, 1) : 0;
			return [route[index - 1][0] + (route[index][0] - route[index - 1][0]) * ratio, route[index - 1][1] + (route[index][1] - route[index - 1][1]) * ratio];
		}
		remaining -= segment;
	}
	return route[route.length - 1];
}

function moveToward(origin: FleetPoint, destination: FleetPoint, distanceMeters: number, result: ScanResult) {
	const distance = meters(origin, destination, result);
	const ratio = distance > 0 ? clamp(distanceMeters / distance, 0, 1) : 1;
	const position: FleetPoint = [origin[0] + (destination[0] - origin[0]) * ratio, origin[1] + (destination[1] - origin[1]) * ratio];
	return { position, arrived: ratio >= 1, heading: (Math.atan2(destination[0] - origin[0], origin[1] - destination[1]) * 180 / Math.PI + 360) % 360 };
}

function record(state: FleetState, second: number, text: string): FleetState {
	return { ...state, events: [{ id: Date.now() + Math.random(), second: Math.floor(second), text }, ...state.events].slice(0, 30) };
}

export function fleetInitial(result: ScanResult): FleetState {
	const routes = result.map.routes?.length ? result.map.routes : [{ vessel_id: 'USV-01', waypoints: result.map.waypoints, region: [] }];
	const boats: FleetBoat[] = routes.map((route) => ({ id: route.vessel_id, position: point(route.waypoints[0] ?? [500, 312]), route: [], region: [], routeIds: [], pathMeters: 0, progress: 0, mode: 'idle', battery: 100, observationId: null }));
	const drones: FleetUav[] = boats.map((boat, index) => ({ id: `UAV-${String(index + 1).padStart(2, '0')}`, carrierId: boat.id, position: boat.position, track: [], mode: 'deck', autoPath: [], autoIndex: 0, target: null, speedMps: 0, commandedSpeedMps: 8, headingDegrees: 0, altitudeM: 0, battery: 100, commandStatus: '待释放' }));
	return { assigned: false, selectedIds: boats.map((boat) => boat.id), boats, drones, observations: [], events: [] };
}

export function selectFleetBoat(state: FleetState, id: string): FleetState {
	if (state.assigned) return state;
	return { ...state, selectedIds: state.selectedIds.includes(id) ? state.selectedIds.filter((item) => item !== id) : [...state.selectedIds, id] };
}

export function assignFleetRoutes(state: FleetState, result: ScanResult, second: number): FleetState {
	const selected = state.boats.filter((boat) => state.selectedIds.includes(boat.id));
	if (!selected.length) return record(state, second, '请先勾选至少一艘无人艇');
	const routes = result.map.routes?.length ? result.map.routes : [{ vessel_id: 'USV-01', waypoints: result.map.waypoints, region: [] }];
	if (selected.length !== routes.length) return record(state, second, `当前规划有 ${routes.length} 条航线，请勾选 ${routes.length} 艘艇；更改艇数需重新规划`);
	const assigned = selected.map((boat, index) => {
		const route = routes[index];
		const waypoints = route.waypoints.map(point);
		return { ...boat, position: waypoints[0] ?? boat.position, route: waypoints, region: route.region, routeIds: [route.vessel_id], pathMeters: result.routes?.find((item) => item.vessel_id === route.vessel_id)?.path_length_m ?? Math.max(1, result.path_length_m / routes.length), progress: 0, mode: 'scan' as FleetBoatMode, battery: 100, observationId: null };
	});
	const boats = state.boats.map((boat) => {
		const match = assigned.find((item) => item.id === boat.id);
		return match ? { ...match, position: match.route[0] ?? boat.position } : { ...boat, route: [], region: [], routeIds: [], pathMeters: 0, progress: 0, mode: 'idle' as FleetBoatMode };
	});
	const drones = state.drones.map((drone) => ({ ...drone, position: boats.find((boat) => boat.id === drone.carrierId)?.position ?? drone.position, track: [], mode: 'deck' as FleetUavMode, battery: 100, altitudeM: 0, commandStatus: '待释放' }));
	return record({ ...state, assigned: true, assignmentId: crypto.randomUUID(), boats, drones, observations: [] }, second, `已将 ${routes.length} 条扫描航线分配给 ${selected.length} 艘无人艇`);
}

function autoPath(boat: FleetBoat): FleetPoint[] {
	if (boat.route.length < 2) return [];
	let nearestSegment = 0;
	let nearestDistance = Infinity;
	for (let index = 0; index < boat.route.length - 1; index++) {
		const start = boat.route[index];
		const end = boat.route[index + 1];
		const dx = end[0] - start[0];
		const dy = end[1] - start[1];
		const ratio = clamp(((boat.position[0] - start[0]) * dx + (boat.position[1] - start[1]) * dy) / Math.max(dx * dx + dy * dy, 1e-9), 0, 1);
		const distance = length(boat.position, [start[0] + dx * ratio, start[1] + dy * ratio]);
		if (distance < nearestDistance) { nearestDistance = distance; nearestSegment = index; }
	}
	// Follow actual validated scan segments. Offsetting waypoints can send UAVs into
	// another DARP partition or across an island at a concave boundary.
	return boat.route.slice(nearestSegment + 1, nearestSegment + 9).map(point);
}

export function releaseFleetUav(state: FleetState, carrierId: string, second: number): FleetState {
	const boat = state.boats.find((item) => item.id === carrierId);
	const drone = state.drones.find((item) => item.carrierId === carrierId);
	if (!state.assigned || !boat?.route.length || boat.mode === 'done' || !drone || drone.mode !== 'deck' || drone.battery < 35) return state;
	const next: FleetUav = { ...drone, mode: 'auto', position: boat.position, track: [boat.position], autoPath: autoPath(boat), autoIndex: 0, speedMps: UAV_AUTO_MPS, commandedSpeedMps: UAV_AUTO_MPS, altitudeM: 50, commandStatus: '起飞命令已接收 · 自动搜索' };
	return record({ ...state, drones: state.drones.map((item) => item.id === drone.id ? next : item) }, second, `${drone.id} 从 ${boat.id} 释放并开始搜索`);
}

export type FleetUavCommand = 'auto' | 'manual' | 'return' | 'hover';
export function commandFleetUav(state: FleetState, id: string, command: FleetUavCommand, second: number, values?: { speedMps?: number; headingDegrees?: number; altitudeM?: number; target?: FleetPoint | null }): FleetState {
	const drone = state.drones.find((item) => item.id === id);
	if (!drone) return state;
	if (drone.mode === 'deck') return record({ ...state, drones: state.drones.map((item) => item.id === id ? { ...item, commandStatus: '命令未接收：请先释放 UAV' } : item) }, second, `${id} 命令未接收：尚未起飞`);
	const speed = values?.speedMps ?? drone.commandedSpeedMps;
	const heading = values?.headingDegrees ?? drone.headingDegrees;
	const altitude = values?.altitudeM ?? drone.altitudeM;
	if (command === 'manual' && (!Number.isFinite(speed) || speed < 0 || speed > 30 || !Number.isFinite(heading) || heading < 0 || heading >= 360 || !Number.isFinite(altitude) || altitude < 10 || altitude > 120)) {
		return { ...state, drones: state.drones.map((item) => item.id === id ? { ...item, commandStatus: '命令未接收：速度 0–30 m/s、航向 0–359°、高度 10–120 m' } : item) };
	}
	const carrier = state.boats.find((boat) => boat.id === drone.carrierId);
	const next: FleetUav = { ...drone, mode: command, commandedSpeedMps: speed, headingDegrees: heading, altitudeM: command === 'return' ? 50 : altitude, target: command === 'manual' ? values?.target === undefined ? drone.target : values.target : null, autoPath: command === 'auto' && carrier ? autoPath(carrier) : drone.autoPath, autoIndex: command === 'auto' ? 0 : drone.autoIndex, speedMps: command === 'hover' ? 0 : command === 'return' || command === 'auto' ? UAV_AUTO_MPS : speed, commandStatus: `命令已接收 · ${({ auto: '自动搜索', manual: '手动控制', return: '返回母艇', hover: '悬停' } as const)[command]}` };
	return record({ ...state, drones: state.drones.map((item) => item.id === id ? next : item) }, second, `${id} ${next.commandStatus}`);
}

export function reportFleetObservation(state: FleetState, id: string, second: number, observedAt = new Date().toISOString(), observationId?: string, recipients?: string[]): FleetState {
	const drone = state.drones.find((item) => item.id === id);
	if (!drone || drone.mode === 'deck') return state;
	const idForObservation = observationId ?? `OBS-${state.observations.length + 1}`;
	if (state.observations.some((item) => item.id === idForObservation)) return state;
	const observation: FleetObservation = { id: idForObservation, position: point(drone.position), observedAt, sourceId: id, receivedBy: recipients ?? state.boats.filter((boat) => boat.id !== drone.carrierId).map((boat) => boat.id), verifiedBy: null };
	return record({ ...state, observations: [observation, ...state.observations] }, second, `${id} 报告训练目标 ${observation.id}；已共享给其他无人艇`);
}

export function respondFleetObservation(state: FleetState, boatId: string, observationId: string, action: 'pause' | 'verify' | 'continue', second: number): FleetState {
	const observation = state.observations.find((item) => item.id === observationId);
	const boat = state.boats.find((item) => item.id === boatId);
	if (!observation?.receivedBy.includes(boatId) || !boat) return state;
	const mode: FleetBoatMode = action === 'pause' ? 'paused' : action === 'verify' ? 'verify' : boat.route.length ? 'resume' : 'idle';
	return record({ ...state, boats: state.boats.map((item) => item.id === boatId ? { ...item, mode, observationId } : item) }, second, `${boatId} 已接收 ${observationId}：${action === 'pause' ? '暂停扫描' : action === 'verify' ? '前往核查' : '继续扫描'}`);
}

export function advanceFleet(state: FleetState, elapsed: number, speedKnots: number, result: ScanResult, second: number, trainingTarget?: FleetPoint | null): FleetState {
	if (!state.assigned || elapsed <= 0) return state;
	const distance = Math.max(0, speedKnots) * KNOT_MPS * elapsed;
	let observations = state.observations;
	let events = state.events;
	const boats = state.boats.map((boat): FleetBoat => {
		if (boat.mode === 'scan' && boat.route.length) {
			const progress = clamp(boat.progress + distance / Math.max(boat.pathMeters, 1), 0, 1);
			const done = progress >= 1;
			if (done && boat.progress < 1) events = [{ id: Date.now() + Math.random(), second: Math.floor(second), text: `${boat.id} 完成扫描航线` }, ...events].slice(0, 30);
			return { ...boat, progress, position: routePoint(boat.route, progress, result), mode: done ? 'done' : 'scan', battery: clamp(boat.battery - elapsed / USV_ENDURANCE_SECONDS * 100, 0, 100) };
		}
		if ((boat.mode === 'verify' || boat.mode === 'resume') && boat.observationId) {
			const observation = observations.find((item) => item.id === boat.observationId);
			const destination = boat.mode === 'verify' ? observation?.position : routePoint(boat.route, boat.progress, result);
			if (!destination) return boat;
			const moved = moveToward(boat.position, destination, distance, result);
			if (boat.mode === 'verify' && moved.arrived && observation) {
				observations = observations.map((item) => item.id === observation.id ? { ...item, verifiedBy: boat.id } : item);
				events = [{ id: Date.now() + Math.random(), second: Math.floor(second), text: `${boat.id} 完成 ${observation.id} 核查` }, ...events].slice(0, 30);
			}
			return { ...boat, position: moved.position, mode: moved.arrived ? boat.mode === 'verify' ? 'paused' : 'scan' : boat.mode, observationId: moved.arrived && boat.mode === 'resume' ? null : boat.observationId, battery: clamp(boat.battery - elapsed / USV_ENDURANCE_SECONDS * 100, 0, 100) };
		}
		return boat;
	});
	const drones = state.drones.map((drone): FleetUav => {
		const carrier = boats.find((boat) => boat.id === drone.carrierId);
		if (drone.mode === 'deck') return { ...drone, position: carrier?.position ?? drone.position, speedMps: 0, altitudeM: 0 };
		let mode = drone.mode;
		let position = drone.position;
		let heading = drone.headingDegrees;
		let autoIndex = drone.autoIndex;
		let target = drone.target;
		let speed = mode === 'hover' ? 0 : mode === 'manual' ? drone.commandedSpeedMps : mode === 'return' ? UAV_RETURN_MPS : UAV_AUTO_MPS;
		const battery = clamp(drone.battery - elapsed / UAV_ENDURANCE_SECONDS * 100, 0, 100);
		let commandStatus = drone.commandStatus;
		if (battery <= 35 && mode !== 'return') { mode = 'return'; target = null; speed = UAV_RETURN_MPS; commandStatus = '低电量自动返航'; }
		if (carrier?.mode === 'done' && mode !== 'return') { mode = 'return'; target = null; speed = UAV_RETURN_MPS; commandStatus = '扫描结束，自动返航'; }
		if (mode === 'auto') {
			let remaining = speed * elapsed;
			while (autoIndex < drone.autoPath.length && remaining > 0) {
				const destination = drone.autoPath[autoIndex];
				const segment = meters(position, destination, result);
				const moved = moveToward(position, destination, remaining, result);
				position = moved.position; heading = moved.heading;
				remaining -= Math.min(segment, remaining);
				if (moved.arrived) autoIndex += 1; else break;
			}
			if (autoIndex >= drone.autoPath.length) { mode = 'return'; commandStatus = '搜索航线完成，自动返航'; }
		} else if (mode === 'manual') {
			if (target) {
				const moved = moveToward(position, target, speed * elapsed, result);
				position = moved.position; heading = moved.heading;
				if (moved.arrived) { mode = 'hover'; target = null; speed = 0; commandStatus = '到达目标点，悬停中'; }
			} else {
				const factor = scale(result);
				const radians = heading * Math.PI / 180;
				position = [clamp(position[0] + Math.sin(radians) * speed * elapsed / factor.x, 0, 1000), clamp(position[1] - Math.cos(radians) * speed * elapsed / factor.y, 0, 625)];
			}
		} else if (mode === 'return' && carrier) {
			const moved = moveToward(position, carrier.position, speed * elapsed, result);
			position = moved.position; heading = moved.heading;
			if (moved.arrived) return { ...drone, position: carrier.position, track: [...drone.track, carrier.position].slice(-300), mode: 'deck', target: null, speedMps: 0, headingDegrees: heading, altitudeM: 0, battery, commandStatus: '已返回母艇' };
		}
		const track = !drone.track.length || length(drone.track[drone.track.length - 1], position) >= 2 ? [...drone.track, position].slice(-300) : drone.track;
		return { ...drone, position, track, mode, target, autoIndex, speedMps: speed, headingDegrees: heading, battery, commandStatus };
	});
	if (trainingTarget && !observations.some((item) => meters(item.position, trainingTarget, result) < 20)) {
		const detector = drones.find((drone) => drone.mode !== 'deck' && meters(drone.position, trainingTarget, result) <= 50);
		if (detector) {
			const reported = reportFleetObservation({ ...state, boats, drones, observations, events }, detector.id, second);
			observations = reported.observations.map((item, index) => index === 0 ? { ...item, position: point(trainingTarget) } : item);
			events = reported.events;
		}
	}
	return { ...state, boats, drones, observations, events };
}

export function fleetProgress(state: FleetState): number {
	const active = state.boats.filter((boat) => boat.route.length);
	const total = active.reduce((sum, boat) => sum + boat.pathMeters, 0);
	return total ? Math.round(active.reduce((sum, boat) => sum + boat.pathMeters * boat.progress, 0) / total * 100) : 0;
}

export function fleetFinished(state: FleetState): boolean {
	return state.assigned && state.boats.filter((boat) => boat.route.length).every((boat) => boat.mode === 'done') && state.drones.every((drone) => drone.mode === 'deck');
}
