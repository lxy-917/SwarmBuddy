import type { ContentBlock, ToolCallBlock, ToolResultBlock } from '@agentscope-ai/agentscope/message';

import { getResultText } from '@/components/chat/tool-renderers/_shared';

const actionMarker = '[SwarmBuddyMissionContext JSON]';
const actionNote = '这是页面刚完成的操作回执。请结合当前任务数据自行回答用户，不要重复执行该操作，也不要逐字照抄回执。';

export function missionActionContext(report: unknown) {
	return `${actionMarker}\n${JSON.stringify({ action_result: report })}\n${actionNote}`;
}

const toolLabels: Record<string, string> = {
	PlanOceanScan: '生成扫描航迹',
	ReadOceanScanResult: '读取扫描方案',
	ReadMissionSituation: '读取艇机仿真状态',
	ReadOceanConditions: '查询海况预报',
	ReadOceanObservations: '查询海域实况',
};

const actionLabels: Record<string, string> = {
	scan_planning: '生成扫描航迹',
	route_optimization: '请求航线优化',
	map_locate: '定位地图对象',
};

export type ReplyActivityState = 'success' | 'running' | 'waiting' | 'confirm' | 'missing' | 'error' | 'interrupted' | 'denied';
export type ReplyActivity = { id: string; label: string; state: ReplyActivityState; statusText?: string };

export type ReplyPlan = {
	origin: 'planned' | 'read';
	source?: 'demo' | 'provided' | 'bounds_only';
	bounds?: { west: number; east: number; south: number; north: number };
	distanceM: number;
	coveragePercent: number;
	vessels?: number;
	waypoints?: number;
	obstacles?: number;
	durationHours?: number;
	validated?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseRecord(text: string) {
	try {
		return asRecord(JSON.parse(text));
	} catch {
		return undefined;
	}
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readPlan(data: Record<string, unknown>, origin: ReplyPlan['origin']): ReplyPlan | null {
	const distanceM = finiteNumber(data.path_length_m);
	const coveragePercent = finiteNumber(data.planned_coverage_percent);
	if (distanceM === undefined || coveragePercent === undefined) return null;
	const bounds = asRecord(data.bounds);
	const west = finiteNumber(bounds?.west), east = finiteNumber(bounds?.east);
	const south = finiteNumber(bounds?.south), north = finiteNumber(bounds?.north);
	const source = data.source;
	return {
		origin,
		source: source === 'demo' || source === 'provided' || source === 'bounds_only' ? source : undefined,
		bounds: west !== undefined && east !== undefined && south !== undefined && north !== undefined ? { west, east, south, north } : undefined,
		distanceM,
		coveragePercent,
		vessels: finiteNumber(data.vessel_count) ?? (Array.isArray(data.routes) && data.routes.length > 0 ? data.routes.length : undefined),
		waypoints: finiteNumber(data.waypoint_count),
		obstacles: finiteNumber(data.obstacle_count),
		durationHours: finiteNumber(data.estimated_duration_hours),
		validated: typeof data.validated === 'boolean' ? data.validated : undefined,
	};
}

function actionReceipt(userContent: ContentBlock[] | undefined) {
	for (const block of userContent?.slice(1) ?? []) {
		if (block.type !== 'text' || !block.text.startsWith(actionMarker + '\n') || !block.text.endsWith('\n' + actionNote)) continue;
		return asRecord(parseRecord(block.text.split('\n')[1])?.action_result);
	}
	return undefined;
}

function getActivityState(call: ToolCallBlock | undefined, result: ToolResultBlock | undefined, data: Record<string, unknown> | undefined, finished: boolean): ReplyActivityState {
	if (result?.state === 'success') {
		if (data?.status === 'unavailable' || data?.status === 'not_found') return 'missing';
		if (data?.status === 'failed' || data?.status === 'error') return 'error';
		return 'success';
	}
	if (result?.state === 'running') return finished ? 'missing' : 'running';
	if (result) return result.state;
	if (finished) return 'missing';
	if (call?.state === 'asking') return 'confirm';
	return call?.state === 'pending' ? 'waiting' : 'running';
}

export function getMissionReplyActivity(content: ContentBlock[], userContent: ContentBlock[] | undefined, finished: boolean) {
	const steps: ReplyActivity[] = [];
	let plan: ReplyPlan | null = null;

	const receipt = actionReceipt(userContent);
	if (receipt && typeof receipt.operation === 'string' && Object.hasOwn(actionLabels, receipt.operation)) {
		const completed = receipt.status === 'completed';
		steps.push({
			id: 'page-action', label: actionLabels[receipt.operation],
			state: completed ? 'success' : receipt.status === 'failed' ? 'error' : 'missing',
			statusText: receipt.status === 'unsupported' ? '暂不支持' : receipt.status === 'not_started' ? '未开始' : undefined,
		});
		if (completed && receipt.operation === 'scan_planning') plan = readPlan(receipt, 'planned');
	}

	const tools = new Map<string, { call?: ToolCallBlock; result?: ToolResultBlock }>();
	for (const block of content) {
		if (block.type !== 'tool_call' && block.type !== 'tool_result') continue;
		const tool = tools.get(block.id) ?? {};
		if (block.type === 'tool_call') tool.call = block;
		else tool.result = block;
		tools.set(block.id, tool);
	}
	for (const [id, { call, result }] of tools) {
		const name = call?.name || result?.name || '';
		const missionTool = Object.hasOwn(toolLabels, name);
		const data = missionTool && result?.state === 'success' ? parseRecord(getResultText(result)) : undefined;
		const state = getActivityState(call, result, data, finished);
		steps.push({ id: 'tool-' + id, label: missionTool ? toolLabels[name] : name || '调用工具', state });
		if (state !== 'success' || !data) continue;
		if (name === 'PlanOceanScan') plan = readPlan(data, 'planned') ?? plan;
		if (name === 'ReadOceanScanResult' && data.status === 'ready' && plan?.origin !== 'planned') {
			plan = readPlan(data, 'read') ?? plan;
		}
	}
	return { steps, plan };
}
