import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./missionCooperationSimulation.ts', import.meta.url), 'utf8');
const fleetSource = readFileSync(new URL('./missionFleet.ts', import.meta.url), 'utf8');
const fleetJavascript = ts.transpileModule(fleetSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const fleetUrl = `data:text/javascript;base64,${Buffer.from(fleetJavascript).toString('base64')}`;
const fleet = await import(fleetUrl);
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace("from './missionFleet'", `from '${fleetUrl}'`);
const simulation = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('旧航迹只显示已规划的单艇及演示无人机', () => {
	const route = [[0, 0], [100, 0], [100, 100], [200, 100], [200, 200]];
	const result = { path_length_m: 400, map: { waypoints: route } };
	assert.equal(simulation.routeSplit(route), 2);
	const assets = simulation.simulationAssets(result, simulation.simulationInitial());
	assert.deepEqual(assets.map((asset) => asset.id), ['UAV-01', 'USV-01']);
	assert.deepEqual(assets.slice(0, 2).map((asset) => asset.position), [[0, 0], [100, 100]]);
	assert.equal(new Set(assets.map((asset) => asset.position.join(','))).size, 2);
});

test('两艇 DARP 规划只显示两艇及各自的演示无人机', () => {
	const first = [[0, 0], [100, 0], [100, 100]];
	const second = [[0, 100], [50, 100], [50, 200]];
	const result = { map: { waypoints: first, routes: [
		{ vessel_id: 'USV-01', waypoints: first, region: [] },
		{ vessel_id: 'USV-02', waypoints: second, region: [] },
	] } };
	const assets = simulation.simulationAssets(result, simulation.simulationInitial());
	assert.deepEqual(assets.map((asset) => asset.id), ['USV-01', 'USV-02', 'UAV-01', 'UAV-02']);
	assert.equal(assets.filter((asset) => asset.kind === 'usv').length, 2);
	assert.deepEqual(assets[3].position, second[0]);
});

test('按实际经过时间连续移动，暂停后位置保持不变', () => {
	const route = [[0, 0], [100, 0], [100, 100], [200, 100], [200, 200]];
	const result = { path_length_m: 400, map: { waypoints: route } };
	let state = simulation.startSimulation(simulation.simulationInitial());
	const initial = simulation.simulationAssets(result, state)[0].position;
	state = simulation.advanceSimulation(state, 0.05, result, 8);
	assert.equal(state.second, 0.05);
	assert.ok(simulation.simulationAssets(result, state)[0].position[0] > initial[0]);
	const paused = simulation.pauseSimulation(state);
	assert.equal(simulation.advanceSimulation(paused, 0.05, result, 8), paused);
});

test('10 节航速经过一小时航行 18.52 公里，短航线的艇先抵达', () => {
	const first = [[0, 0], [100, 0]];
	const second = [[0, 100], [100, 100]];
	const result = {
		path_length_m: 55_560,
		routes: [
			{ vessel_id: 'USV-01', path_length_m: 37_040 },
			{ vessel_id: 'USV-02', path_length_m: 18_520 },
		],
		map: { waypoints: first, routes: [
			{ vessel_id: 'USV-01', waypoints: first, region: [] },
			{ vessel_id: 'USV-02', waypoints: second, region: [] },
		] },
	};
	const state = simulation.advanceSimulation(simulation.startSimulation(simulation.simulationInitial()), 3600, result, 10);
	assert.equal(state.second, 3600);
	assert.equal(simulation.formatMissionElapsed(state.second), '01:00:00');
	assert.equal(state.usvProgress, .5);
	const boats = simulation.simulationAssets(result, state).filter((asset) => asset.kind === 'usv');
	assert.equal(boats[0].progress, .5);
	assert.equal(boats[1].progress, 1);
	assert.equal(state.running, true);
});

test('默认 3.4 节规划下，8 公里航线运行一分钟不会结束', () => {
	const route = [[0, 0], [100, 0]];
	const result = { path_length_m: 8000, routes: [{ vessel_id: 'USV-01', path_length_m: 8000 }], map: { waypoints: route, routes: [{ vessel_id: 'USV-01', waypoints: route, region: [] }] } };
	const state = simulation.advanceSimulation(simulation.startSimulation(simulation.simulationInitial()), 60, result, 3.4);
	const boat = simulation.simulationAssets(result, state).find((asset) => asset.id === 'USV-01');
	assert.ok(boat.progress > .01 && boat.progress < .02);
	assert.equal(state.running, true);
});

test('分配后的多艇状态驱动位置、进度和任务计时', () => {
	const first = [[0, 0], [100, 0]];
	const result = { bounds: { west: 119.68, east: 119.72, south: 25.53, north: 25.57 }, path_length_m: 2000, routes: [{ vessel_id: 'USV-01', path_length_m: 2000 }], map: { region: [[[0, 0], [1000, 0], [1000, 625], [0, 625]]], waypoints: first, routes: [{ vessel_id: 'USV-01', waypoints: first, region: [] }] } };
	let state = simulation.simulationInitial(result);
	assert.equal(state.fleet.assigned, false);
	state = { ...state, fleet: fleet.assignFleetRoutes(state.fleet, result, 0) };
	state = simulation.startSimulation(state, result);
	state = simulation.advanceSimulation(state, 60, result, 10);
	assert.equal(state.second, 60);
	assert.ok(simulation.simulatedCoverage(state) > 0);
	assert.ok(simulation.simulationAssets(result, state).find((asset) => asset.id === 'USV-01').position[0] > 0);
});

test('已航行轨迹按实际路径长度截取，末端连续插值', () => {
	const route = [[0, 0], [100, 0], [100, 100]];
	assert.deepEqual(simulation.routePrefix(route, 0), [[0, 0]]);
	assert.deepEqual(simulation.routePrefix(route, .75), [[0, 0], [100, 0], [100, 50]]);
	assert.deepEqual(simulation.routePrefix(route, 1), route);
});

test('失联后无人艇接替剩余分区，训练目标随后复核', () => {
	const route = [[0, 0], [100, 0], [100, 100], [200, 100], [200, 200]];
	const result = { path_length_m: 400, map: { waypoints: route } };
	let state = simulation.startSimulation(simulation.simulationInitial());
	for (let index = 0; index < 10; index++) state = simulation.advanceSimulation(state, 1, result, 8);
	state = simulation.injectSimulatedTarget(state, route);
	assert.equal(state.targetStatus, 'suspected');
	state = simulation.simulateLinkLoss(state);
	assert.equal(state.uavOffline, true);
	for (let index = 0; index < 240 && state.running; index++) state = simulation.advanceSimulation(state, 1, result, 8);
	assert.equal(state.running, false);
	assert.equal(state.targetStatus, 'confirmed');
	assert.equal(simulation.simulatedCoverage(state), 100);
	assert.ok(state.events.some((event) => event.text.includes('接替')));
});
