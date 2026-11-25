import type { ScanResult } from '@/api/missionScan';

/** 示例航速参考 NOAA Saildrone Surveyor 任务平均航速 3.37596 节，保留一位小数：https://www.ngdc.noaa.gov/ships/saildrone_surveyor/SD1200-0012-13_mb.html */
export const EXAMPLE_SCAN_SPEED_KNOTS = 3.4;

function key(agentId?: string, sessionId?: string) {
	return agentId && sessionId ? `swarmbuddy.scanSpeed.${agentId}.${sessionId}` : null;
}

export function readScanSpeed(agentId?: string, sessionId?: string, resultSpeed?: number | null): number {
	const storageKey = key(agentId, sessionId);
	const stored = storageKey ? Number(localStorage.getItem(storageKey)) : NaN;
	if (Number.isFinite(stored) && stored > 0) return stored;
	if (typeof resultSpeed === 'number' && Number.isFinite(resultSpeed) && resultSpeed > 0) return resultSpeed;
	return EXAMPLE_SCAN_SPEED_KNOTS;
}

export function saveScanSpeed(agentId: string | undefined, sessionId: string | undefined, speed: number) {
	const storageKey = key(agentId, sessionId);
	if (storageKey && Number.isFinite(speed) && speed > 0) localStorage.setItem(storageKey, String(speed));
}

export function formatPlannedScanDuration(result: ScanResult | null, speedKnots: number, assignedRouteMeters: number[] = []) {
	if (!result || !Number.isFinite(result.path_length_m) || !Number.isFinite(speedKnots) || speedKnots <= 0) return '待计算';
	const routeMeters = assignedRouteMeters.length ? assignedRouteMeters : result.routes?.map((route) => route.path_length_m);
	const longestRoute = routeMeters?.length ? Math.max(...routeMeters) : result.path_length_m;
	const minutes = Math.round(longestRoute / (speedKnots * 1852) * 60);
	return `${Math.floor(minutes / 60)} 小时 ${String(minutes % 60).padStart(2, '0')} 分`;
}
