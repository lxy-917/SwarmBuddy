import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./missionCooperationSimulation.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const simulation = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('协同仿真按航迹长度分区并生成六平台位置', () => {
	const route = [[0, 0], [100, 0], [100, 100], [200, 100], [200, 200]];
	const result = { map: { waypoints: route } };
	assert.equal(simulation.routeSplit(route), 2);
	const assets = simulation.simulationAssets(result, simulation.simulationInitial());
	assert.deepEqual(assets.map((asset) => asset.id), ['UAV-01', 'USV-01', 'UAV-02', 'UAV-03', 'USV-02', 'USV-03']);
	assert.deepEqual(assets.slice(0, 2).map((asset) => asset.position), [[0, 0], [100, 100]]);
	assert.equal(new Set(assets.map((asset) => asset.position.join(','))).size, 6);
});

test('失联后无人艇接替剩余分区，训练目标随后复核', () => {
	const route = [[0, 0], [100, 0], [100, 100], [200, 100], [200, 200]];
	let state = simulation.startSimulation(simulation.simulationInitial());
	for (let index = 0; index < 10; index++) state = simulation.advanceSimulation(state);
	state = simulation.injectSimulatedTarget(state, route);
	assert.equal(state.targetStatus, 'suspected');
	state = simulation.simulateLinkLoss(state);
	assert.equal(state.uavOffline, true);
	for (let index = 0; index < 240 && state.running; index++) state = simulation.advanceSimulation(state);
	assert.equal(state.running, false);
	assert.equal(state.targetStatus, 'confirmed');
	assert.equal(simulation.simulatedCoverage(state), 100);
	assert.ok(state.events.some((event) => event.text.includes('接替')));
});
