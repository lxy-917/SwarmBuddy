import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChatScanCoordinates } from './scanChatCoordinates.ts';

test('中心经纬度和半径可自动换算为扫描边界', () => {
	const parsed = parseChatScanCoordinates('以东经 119.50°、北纬 23.45° 为中心，规划半径 30 公里范围内的海域扫描航线。');
	assert.ok(parsed?.bounds);
	assert.deepEqual(parsed.centerPoint, [119.5, 23.45]);
	assert.equal(parsed.radiusKm, 30);
	assert.equal(parsed.derivedBounds, true);
	assert.ok(parsed.bounds.west < 119.21 && parsed.bounds.east > 119.79);
	assert.ok(parsed.bounds.south < 23.181 && parsed.bounds.north > 23.719);
});

test('只给扫描中心时使用默认半径，普通经纬度问答不触发规划', () => {
	const scan = parseChatScanCoordinates('东经 119.50°、北纬 23.45° 附近生成扫描航线');
	assert.equal(scan?.radiusKm, 5);
	assert.equal(parseChatScanCoordinates('在 119.50, 23.45 周边 30 公里范围内扫描')?.radiusKm, 30);
	assert.equal(parseChatScanCoordinates('东经 119.50°、北纬 23.45° 的气温是多少？'), null);
});

test('半径无效时返回错误，起终点输入仍按原规则解析', () => {
	assert.match(parseChatScanCoordinates('东经 119.50°、北纬 23.45° 为中心，扫描半径 0 公里')?.error ?? '', /半径/);
	const endpoints = parseChatScanCoordinates('起点：119.6810, 25.5310；终点：119.6890, 25.5390，规划扫描航线');
	assert.deepEqual(endpoints?.startPoint, [119.681, 25.531]);
	assert.deepEqual(endpoints?.endPoint, [119.689, 25.539]);
});
