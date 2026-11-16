import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./missionMultiGrid.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const grid = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

const boat = (id, x, y) => ({ id, kind: 'usv', position: [x, y], progress: 0, status: '搜索中', assignment: '' });

test('records traversed cells and detects overlap between vessels', () => {
	let state = grid.multiGridInitial();
	state = grid.advanceMultiGrid(state, [boat('USV-01', 0, 0)], 1);
	state = grid.advanceMultiGrid(state, [boat('USV-01', 72, 0)], 2);
	assert.deepEqual(Object.keys(state.cells).sort(), ['0:0', '1:0', '2:0', '3:0']);
	state = grid.advanceMultiGrid(state, [boat('USV-01', 72, 0), boat('USV-02', 72, 0)], 3);
	assert.deepEqual(state.cells['3:0'].vesselIds, ['USV-01', 'USV-02']);
	assert.equal(grid.multiGridSummary(state).sharedCells, 1);
	assert.ok(Math.abs(grid.multiGridSummary(state).vesselSeconds - 4) < 1e-9);
});

test('reset and inactive time do not reuse old visit history', () => {
	const initial = grid.multiGridInitial(10);
	assert.equal(grid.advanceMultiGrid(initial, [boat('USV-01', 0, 0)], 10), initial);
	const next = grid.advanceMultiGrid(initial, [boat('USV-01', 0, 0)], 10.5);
	assert.equal(grid.multiGridSummary(next).visitedCells, 1);
	assert.equal(grid.multiGridSummary(grid.multiGridInitial(10.5)).visitedCells, 0);
});
