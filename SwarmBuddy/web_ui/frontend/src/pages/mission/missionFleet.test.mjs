import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./missionFleet.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const fleet = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

const route = (vessel_id, y) => ({ vessel_id, waypoints: [[100, y], [300, y]], region: [] });
const result = {
	bounds: { west: 119.68, east: 119.72, south: 25.53, north: 25.57 },
	path_length_m: 6000,
	routes: [
		{ vessel_id: 'USV-01', path_length_m: 2000 },
		{ vessel_id: 'USV-02', path_length_m: 2000 },
		{ vessel_id: 'USV-03', path_length_m: 2000 },
	],
	map: { region: [[[0, 0], [1000, 0], [1000, 625], [0, 625]]], waypoints: route('USV-01', 100).waypoints, routes: [route('USV-01', 100), route('USV-02', 300), route('USV-03', 500)] },
};

test('分配要求每条规划航线对应一艘所选艇，避免新增越岸转场', () => {
	let state = fleet.fleetInitial(result);
	state = fleet.selectFleetBoat(state, 'USV-02');
	state = fleet.assignFleetRoutes(state, result, 0);
	assert.equal(state.selectedIds.length, 2);
	assert.equal(state.assigned, false);
	assert.match(state.events[0].text, /请勾选 3 艘艇/);
	state = fleet.selectFleetBoat(state, 'USV-02');
	state = fleet.assignFleetRoutes(state, result, 0);
	assert.deepEqual(state.boats.map((boat) => boat.routeIds), [['USV-01'], ['USV-02'], ['USV-03']]);
	assert.equal(state.assigned, true);
	assert.equal(state.drones[0].mode, 'deck');
});

test('无人艇按航速推进，释放 UAV 后手动目标与返航均更新位置和遥测', () => {
	let state = fleet.assignFleetRoutes(fleet.fleetInitial(result), result, 0);
	state = fleet.advanceFleet(state, 60, 10, result, 60);
	assert.ok(state.boats[0].progress > .15 && state.boats[0].progress < .16);
	state = fleet.releaseFleetUav(state, 'USV-01', 60);
	const launch = state.drones[0].position;
	assert.equal(state.drones[0].mode, 'auto');
	state = fleet.commandFleetUav(state, 'UAV-01', 'manual', 60, { speedMps: 8, headingDegrees: 90, altitudeM: 60, target: [launch[0] + 30, launch[1]] });
	assert.match(state.drones[0].commandStatus, /已接收/);
	state = fleet.advanceFleet(state, 5, 10, result, 65);
	assert.ok(state.drones[0].position[0] > launch[0]);
	assert.equal(state.drones[0].altitudeM, 60);
	state = fleet.commandFleetUav(state, 'UAV-01', 'return', 65);
	for (let second = 66; second < 100 && state.drones[0].mode !== 'deck'; second++) state = fleet.advanceFleet(state, 1, 10, result, second);
	assert.equal(state.drones[0].mode, 'deck');
	assert.deepEqual(state.drones[0].position, state.boats[0].position);
});

test('UAV 自动搜索沿所属艇航线行进，不向相邻分区偏移', () => {
	const narrowRoute = { vessel_id: 'USV-01', waypoints: [[190, 100], [199, 100], [199, 160], [190, 160]], region: [[[180, 90], [200, 90], [200, 170], [180, 170]]] };
	const localResult = { ...result, map: { ...result.map, routes: [narrowRoute] }, routes: [{ vessel_id: 'USV-01', path_length_m: 2000 }] };
	let state = fleet.assignFleetRoutes(fleet.fleetInitial(localResult), localResult, 0);
	state = fleet.releaseFleetUav(state, 'USV-01', 0);
	assert.deepEqual(state.drones[0].autoPath, narrowRoute.waypoints.slice(1));
	state = fleet.advanceFleet(state, 2, 0, localResult, 2);
	assert.ok(state.drones[0].position[0] >= 180 && state.drones[0].position[0] <= 200);
});

test('观测含时间位置来源，并共享给其他艇核查后可返回原航线', () => {
	let state = fleet.assignFleetRoutes(fleet.fleetInitial(result), result, 0);
	state = fleet.releaseFleetUav(state, 'USV-01', 0);
	state = fleet.reportFleetObservation(state, 'UAV-01', 1, '2026-11-11T02:00:00.000Z');
	const observation = state.observations[0];
	assert.equal(observation.sourceId, 'UAV-01');
	assert.equal(observation.observedAt, '2026-11-11T02:00:00.000Z');
	assert.deepEqual(observation.receivedBy, ['USV-02', 'USV-03']);
	state = fleet.respondFleetObservation(state, 'USV-02', observation.id, 'pause', 2);
	const paused = state.boats[1].position;
	state = fleet.advanceFleet(state, 10, 10, result, 12);
	assert.deepEqual(state.boats[1].position, paused);
	state = fleet.respondFleetObservation(state, 'USV-02', observation.id, 'verify', 12);
	for (let second = 13; second < 1000 && !state.observations[0].verifiedBy; second++) state = fleet.advanceFleet(state, 1, 10, result, second);
	assert.equal(state.observations[0].verifiedBy, 'USV-02');
	assert.equal(state.boats[1].mode, 'paused');
	state = fleet.respondFleetObservation(state, 'USV-02', observation.id, 'continue', 1000);
	for (let second = 1001; second < 2000 && state.boats[1].mode !== 'scan'; second++) state = fleet.advanceFleet(state, 1, 10, result, second);
	assert.equal(state.boats[1].mode, 'scan');
});

test('UAV 接近训练目标自动生成观测，母艇结束扫描后自动返航', () => {
	let state = fleet.assignFleetRoutes(fleet.fleetInitial(result), result, 0);
	state = fleet.releaseFleetUav(state, 'USV-01', 0);
	const trainingTarget = state.drones[0].position;
	state = fleet.advanceFleet(state, 1, 10, result, 1, trainingTarget);
	assert.equal(state.observations.length, 1);
	assert.equal(state.observations[0].sourceId, 'UAV-01');
	for (let second = 2; second < 500 && state.drones[0].mode !== 'deck'; second++) state = fleet.advanceFleet(state, 5, 10, result, second * 5);
	assert.equal(state.drones[0].mode, 'deck');
	assert.deepEqual(state.drones[0].position, state.boats[0].position);
});
