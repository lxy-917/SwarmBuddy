import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./missionRadarGeometry.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const radar = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('雷达按相对距离和方位绘制，缩小量程会放大目标', () => {
	const origin = [500, 300];
	const northEast = [510, 290];
	const normal = radar.radarContactPosition(origin, northEast, 10, 500, 80, 100);
	const zoomed = radar.radarContactPosition(origin, northEast, 10, 250, 80, 100);
	assert.ok(normal.x > 100 && normal.y < 100);
	assert.equal(normal.distance, Math.sqrt(20_000));
	assert.equal(zoomed.x - 100, (normal.x - 100) * 2);
	assert.equal(zoomed.y - 100, (normal.y - 100) * 2);
	assert.equal(radar.radarContactPosition(origin, [600, 300], 10, 250, 80, 100).visible, false);
});
