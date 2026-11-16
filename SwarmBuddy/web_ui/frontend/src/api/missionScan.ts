import { client } from './client';

export type ScanRequest = {
	west: number;
	south: number;
	east: number;
	north: number;
	spacing_m: number;
	obstacle_buffer_m: number;
	vessel_count?: number;
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
	sample?: { longitude: number; latitude: number };
	sample_kind?: 'demo';
	temperature_c?: number | null;
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
	vessel_count?: number;
	planner?: string;
	planner_revision?: number;
	grid_size_m?: number;
	routes?: { vessel_id: string; route_geojson: { type: 'LineString'; coordinates: number[][] }; path_length_m: number; region_area_m2: number; waypoint_count: number }[];
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
		coastline_land?: number[][][];
		context_obstacles?: number[][][];
		no_go_zones?: number[][][];
		waypoints: number[][];
		routes?: { vessel_id: string; waypoints: number[][]; region: number[][][] }[];
		baseline_waypoints?: number[][];
	};
};

export type MissionTaskEvent = {
	event_id: string;
	mission_id: string;
	sender_id: string;
	recipient_ids: string[];
	event_type: string;
	timestamp: string;
	position: [number, number];
	payload: Record<string, unknown>;
	status: string;
	chain: { stage: string; actor_id: string; detail: string; status: string; timestamp: string }[];
	actions: { boat_id?: string; uav_id?: string; action: string; observation_id?: string }[];
	original_proposals?: Record<string, { decision: string; reason?: string }>;
	proposals?: Record<string, { decision: string; reason?: string }>;
	peer_review?: { status: string; summary?: string; reason?: string; findings?: { asset_id: string; concern: string; evidence: string; evidence_value?: unknown }[] };
	revisions?: { asset_id: string; before: { decision: string }; after: { decision: string; reason?: string } }[];
	assessment?: { proposal_count: number; revision_count?: number; validation_rejection_count: number; advisor_fallback_count: number; executed_action_count: number; verification_completed: boolean; verification_elapsed_s: number | null; outcome_score: number | null; outcome_score_reason: string };
	duplicate?: boolean;
	simulation: true;
};

export type MissionTaskAssignment = {
	mission_id: string;
	plan_hash: string;
	boat_ids: string[];
	assets: Record<string, { id: string; agent_id: string; kind: 'usv' | 'uav' | 'coordinator'; carrier_id: string | null; mode: string; online: boolean }>;
	events: Record<string, MissionTaskEvent>;
	simulation: true;
};

export type MissionMapSelection = { kind: 'usv' | 'uav' | 'region' | 'target'; id: string; mission_id: string };
export type MissionChatSnapshot = {
	mission_id: string;
	selected: Pick<MissionMapSelection, 'kind' | 'id'> | null;
	assets: { id: string; kind: 'usv' | 'uav'; position: [number, number]; battery: number; progress: number; mode: string }[];
	observations: { id: string; source_id: string; position: [number, number]; observed_at: string; verified_by: string | null }[];
};

export const missionScanApi = {
	get: (agentId: string, sessionId: string) =>
		client.get<ScanResult>(`/mission/scan/${sessionId}`, { agent_id: agentId }, { silent: true }),
	assignFleet: (agentId: string, sessionId: string, selected_ids: string[], assignment_key: string) =>
		client.post<MissionTaskAssignment>(`/mission/scan/${sessionId}/fleet/assign`, { selected_ids, assignment_key }, { agent_id: agentId }, { silent: true }),
	getFleet: (agentId: string, sessionId: string) =>
		client.get<MissionTaskAssignment>(`/mission/scan/${sessionId}/fleet`, { agent_id: agentId }, { silent: true }),
	submitFleetEvent: (agentId: string, sessionId: string, event: Omit<MissionTaskEvent, 'recipient_ids' | 'status' | 'chain' | 'actions' | 'simulation' | 'duplicate'>) =>
		client.post<MissionTaskEvent>(`/mission/scan/${sessionId}/fleet/events`, event, { agent_id: agentId }, { silent: true }),
	saveChatState: (agentId: string, sessionId: string, snapshot: MissionChatSnapshot) =>
		client.post<MissionChatSnapshot>(`/mission/scan/${sessionId}/chat-state`, snapshot, { agent_id: agentId }, { silent: true }),
	clearChatState: (agentId: string, sessionId: string) =>
		client.delete<{ status: string }>(`/mission/scan/${sessionId}/chat-state`, { agent_id: agentId }),
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
