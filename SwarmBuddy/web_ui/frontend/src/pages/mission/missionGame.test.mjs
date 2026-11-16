import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./missionGame.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { createGame, stepGame, gameScore } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('user selected team sizes and seed make repeatable episodes', () => {
	const config = { redCount: 2, blueCount: 5, seed: 42, redStrategy: 'coordinate', blueStrategy: 'coverage' };
	const first = createGame(config);
	assert.equal(first.boats.filter((boat) => boat.side === 'red').length, 2);
	assert.equal(first.boats.filter((boat) => boat.side === 'blue').length, 5);
	assert.equal(first.targets.filter((target) => target.real).length, 3);
	assert.deepEqual(first, createGame(config));
	let a = first;
	let b = createGame(config);
	for (let turn = 0; turn < a.maxTurns; turn++) { a = stepGame(a); b = stepGame(b); }
	assert.deepEqual(a, b);
	assert.equal(stepGame(a), a);
	assert.ok(Number.isFinite(gameScore(a, 'red').points));
});
