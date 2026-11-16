import type { parseChatScanCoordinates } from './scanChatCoordinates';
import type { ScanResult } from '@/api/missionScan';

/** Data passed to the chat model after the page has executed a scan action. */
export function scanPlanReport(result: ScanResult, derivedBounds = false, radiusKm?: number) {
	return {
		operation: 'scan_planning', status: 'completed', source: result.source,
		validated: result.validated, bounds: result.bounds,
		derived_bounds: derivedBounds, requested_radius_km: radiusKm ?? null,
		start_point_wgs84: result.start_point, end_point_wgs84: result.end_point,
		vessel_count: result.routes?.length ?? result.vessel_count,
		path_length_m: result.path_length_m,
		planned_coverage_percent: result.planned_coverage_percent,
		estimated_duration_hours: result.estimated_duration_hours,
		route_optimized: result.route_optimized,
		baseline_path_length_m: result.baseline_path_length_m,
		scan_segment_length_m: result.scan_segment_length_m,
	};
}

export function scanMatchesCoordinates(result: ScanResult, coordinates: ReturnType<typeof parseChatScanCoordinates>): boolean {
	if (!coordinates) return false;
	const same = (left: number, right: number) => Math.abs(left - right) < 0.00005;
	const samePoint = (actual: [number, number] | null | undefined, expected: [number, number]) =>
		Boolean(actual && same(actual[0], expected[0]) && same(actual[1], expected[1]));
	return (!coordinates.startPoint || samePoint(result.start_point, coordinates.startPoint))
		&& (!coordinates.endPoint || samePoint(result.end_point, coordinates.endPoint))
		&& (!coordinates.bounds || Object.entries(coordinates.bounds).every(([key, value]) =>
			same(result.bounds[key as keyof ScanResult['bounds']], value)));
}
