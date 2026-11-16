import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMissionChatSnapshot, locateMissionObject, parseLocateRequest } from './missionChatBridge.ts';

const scan = {
  bounds: { west: 119.68, east: 119.72, south: 25.53, north: 25.57 },
  vessel_count: 2, path_length_m: 12000, planned_coverage_percent: 97,
  estimated_duration_hours: 2.5,
  map: { region: [[[0, 0], [1000, 0], [1000, 625], [0, 625]]],
    routes: [{ vessel_id: 'USV-01', waypoints: [[100, 100]], region: [[[0, 0], [500, 0], [500, 625], [0, 625]]] },
      { vessel_id: 'USV-02', waypoints: [[700, 100]], region: [[[500, 0], [1000, 0], [1000, 625], [500, 625]]] }] },
};
const fleet = {
  assigned: true,
  boats: [{ id: 'USV-01', route: [[100, 100]], position: [120, 150], progress: .2, battery: 90, mode: 'scan' },
    { id: 'USV-02', route: [[700, 100]], position: [720, 150], progress: .3, battery: 80, mode: 'scan' }],
  drones: [{ id: 'UAV-01', carrierId: 'USV-01', position: [130, 140], battery: 70, mode: 'auto' }],
  observations: [{ id: 'target-1', sourceId: 'UAV-01', position: [200, 200], observedAt: '2026-11-11T10:00:00Z', verifiedBy: null }],
};

test('任务问答不被当作定位命令，交给模型处理', () => {
  for (const input of ['当前扫描方案怎么样', 'USV-01 在哪里', 'UAV-01 正在做什么', '当前疑似目标是谁发现的', '它在哪里']) {
    assert.equal(parseLocateRequest(input), null);
  }
});

test('地图选中 UAV 后可用它追问，并定位 USV 分区', () => {
  assert.deepEqual(parseLocateRequest('在地图上找到 UAV-01'), { kind: 'uav', id: 'UAV-01' });
  const request = parseLocateRequest('显示 USV-02 的分区');
  assert.deepEqual(request, { kind: 'region', id: 'USV-02' });
  assert.deepEqual(locateMissionObject(request, scan, fleet).position, [750, 312.5]);
  assert.match(locateMissionObject({ kind: 'uav', id: 'UAV-99' }, scan, fleet).error, /没有 UAV-99/);
});

test('结构化快照只携带当前任务选中对象', () => {
  assert.equal(buildMissionChatSnapshot('mission-a', fleet, { kind: 'uav', id: 'UAV-01', mission_id: 'mission-a' }).selected.id, 'UAV-01');
  assert.equal(buildMissionChatSnapshot('mission-b', fleet, { kind: 'uav', id: 'UAV-01', mission_id: 'mission-a' }).selected, null);
});
