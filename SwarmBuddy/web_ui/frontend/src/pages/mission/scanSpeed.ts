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
