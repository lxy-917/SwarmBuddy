import type { FleetState, FleetPoint } from './missionFleet';
import type { MissionChatSnapshot, MissionMapSelection, ScanResult } from '@/api/missionScan';

export type LocateRequest = { kind: MissionMapSelection['kind']; id: string };

export function parseLocateRequest(input: string): LocateRequest | null {
	if (!/(?:地图|定位|找到|显示)/.test(input)) return null;
	const asset = input.match(/\b(UAV|USV)[-－]?0*(\d{1,2})\b/i);
	if (asset) {
		const id = `${asset[1].toUpperCase()}-${asset[2].padStart(2, '0')}`;
		return { kind: asset[1].toUpperCase() === 'USV' && /分区|区域/.test(input) ? 'region' : asset[1].toLowerCase() as 'usv' | 'uav', id };
	}
	return /疑似目标|训练目标|目标位置/.test(input) ? { kind: 'target', id: 'latest' } : null;
}

export function locateMissionObject(request: LocateRequest, scan: ScanResult | null, fleet: FleetState | null): { position: FleetPoint; id: string } | { error: string } {
	if (!scan) return { error: '当前会话没有扫描方案，无法定位地图对象。' };
	if (request.kind === 'target') {
		const target = fleet?.assigned ? fleet.observations[0] : null;
		return target ? { position: target.position, id: target.id }
			: { error: '当前任务还没有训练疑似目标。' };
	}
	if (request.kind === 'uav') {
		const drone = fleet?.assigned ? fleet.drones.find((item) => item.id === request.id) : null;
		return drone ? { position: drone.position, id: drone.id }
			: { error: `当前任务没有 ${request.id}。` };
	}
	const boat = fleet?.assigned ? fleet.boats.find((item) => item.id === request.id && item.route.length > 0) : null;
	const route = scan.map.routes?.find((item) => item.vessel_id === request.id);
	if (!route) return { error: `当前扫描方案没有 ${request.id} 的分区或航线。` };
	if (request.kind === 'region') {
		const ring = route.region[0];
		if (!ring?.length) return { error: `${request.id} 没有可定位的分区几何。` };
		const center: FleetPoint = [ring.reduce((sum, point) => sum + point[0], 0) / ring.length, ring.reduce((sum, point) => sum + point[1], 0) / ring.length];
		return { position: center, id: request.id };
	}
	const position = boat?.position ?? route.waypoints[0] as FleetPoint | undefined;
	return position ? { position, id: request.id }
		: { error: `${request.id} 没有可定位的位置。` };
}

export function buildMissionChatSnapshot(missionId: string, fleet: FleetState, selected: MissionMapSelection | null): MissionChatSnapshot {
	return {
		mission_id: missionId,
		selected: selected?.mission_id === missionId ? { kind: selected.kind, id: selected.id } : null,
		assets: [
			...fleet.boats.filter((boat) => boat.route.length > 0).map((boat) => ({ id: boat.id, kind: 'usv' as const, position: boat.position, battery: boat.battery, progress: boat.progress, mode: boat.mode })),
			...fleet.drones.filter((drone) => fleet.boats.some((boat) => boat.id === drone.carrierId && boat.route.length > 0)).map((drone) => ({ id: drone.id, kind: 'uav' as const, position: drone.position, battery: drone.battery, progress: 0, mode: drone.mode })),
		],
		observations: fleet.observations.map((target) => ({ id: target.id, source_id: target.sourceId, position: target.position, observed_at: target.observedAt, verified_by: target.verifiedBy })),
	};
}

