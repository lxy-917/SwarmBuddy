import { client } from './client';

export type ScanRequest = {
	west: number;
	south: number;
	east: number;
	north: number;
	spacing_m: number;
	obstacle_buffer_m: number;
	speed_knots?: number;
	start_point?: [number, number] | null;
	end_point?: [number, number] | null;
	use_requested_bounds?: boolean;
	allow_bounds_only?: boolean;
	optimize_route?: boolean;
};

export type ScanGeoJSON = Record<string, unknown>;

export type MarineConditions = {
	source: string;
	kind: string;
	sample_count: number;
	samples: { longitude: number; latitude: number }[];
	sample: { longitude: number; latitude: number };
	marine_grid: { longitude: number; latitude: number; distance_km: number };
	weather_grid: { longitude: number; latitude: number; distance_km: number };
	marine_time: string | null;
	weather_time: string | null;
	wave_height_m: number | null;
	wave_period_s: number | null;
	visibility_km: number | null;
	wind_speed_ms: number | null;
};

export type MarineObservations = {
	status: 'observed' | 'unavailable';
	source: string;
	kind: string;
	message?: string;
	search_radius_km?: number;
	station?: { id: string; longitude: number; latitude: number; distance_km: number };
	observed_at?: string;
	wave_height_m?: number | null;
	wave_period_s?: number | null;
	wind_speed_ms?: number | null;
	visibility_km?: number | null;
};

export type ScanEnvironmentInfo = {
	filename: string;
	has_search_region: boolean;
	obstacle_count: number;
	no_go_zone_count: number;
	bounds?: Pick<ScanRequest, 'west' | 'south' | 'east' | 'north'>;
};

export type ScanResult = {
	bounds: Pick<ScanRequest, 'west' | 'south' | 'east' | 'north'>;
	spacing_m: number;
	obstacle_buffer_m: number;
	speed_knots?: number | null;
	start_point?: [number, number] | null;
	end_point?: [number, number] | null;
	estimated_duration_hours?: number | null;
	path_length_m: number;
	scan_segment_length_m?: number;
	baseline_path_length_m?: number | null;
	route_optimized?: boolean;
	waypoint_count: number;
	obstacle_count: number;
	no_go_zone_count?: number;
	planned_coverage_percent: number;
	covered_area_m2: number;
	target_area_m2: number;
	route_type: string;
	validated: boolean;
	source: 'demo' | 'provided' | 'bounds_only';
	route_geojson: { type: 'LineString'; coordinates: number[][] };
	map: {
		region: number[][][];
		obstacles: number[][][];
		context_obstacles?: number[][][];
		no_go_zones?: number[][][];
		waypoints: number[][];
		baseline_waypoints?: number[][];
	};
};

export const missionScanApi = {
	get: (agentId: string, sessionId: string) =>
		client.get<ScanResult>(`/mission/scan/${sessionId}`, { agent_id: agentId }, { silent: true }),
	getConditions: (agentId: string, sessionId: string) =>
		client.get<MarineConditions>(`/mission/scan/${sessionId}/conditions`, { agent_id: agentId }, { silent: true }),
	getObservations: (agentId: string, sessionId: string) =>
		client.get<MarineObservations>(`/mission/scan/${sessionId}/observations`, { agent_id: agentId }, { silent: true }),
	create: (agentId: string, sessionId: string, request: ScanRequest & { environment_data?: ScanGeoJSON; use_demo?: boolean }) =>
		client.post<ScanResult>(`/mission/scan/${sessionId}`, request, { agent_id: agentId }, { silent: true }),
	updateSpeed: (agentId: string, sessionId: string, speed_knots: number) =>
		client.patch<ScanResult>(`/mission/scan/${sessionId}/speed`, { speed_knots }, { agent_id: agentId }, { silent: true }),
	savePlan: (agentId: string, sessionId: string) =>
		client.post<{ saved_at: string; plan_id: string }>(`/mission/scan/${sessionId}/save`, {}, { agent_id: agentId }, { silent: true }),
	getEnvironment: (agentId: string, sessionId: string) =>
		client.get<ScanEnvironmentInfo>(`/mission/scan/${sessionId}/environment`, { agent_id: agentId }, { silent: true }),
	saveEnvironment: (agentId: string, sessionId: string, filename: string, environment_data: ScanGeoJSON) =>
		client.post<ScanEnvironmentInfo>(`/mission/scan/${sessionId}/environment`, { filename, environment_data }, { agent_id: agentId }, { silent: true }),
};
