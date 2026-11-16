import assert from 'node:assert/strict';
import test from 'node:test';

import { scanMatchesCoordinates, scanPlanReport } from './missionChatActions.ts';

const plan = {
  bounds: { west: 119.68, south: 25.53, east: 119.72, north: 25.57 },
  start_point: [119.69, 25.54], end_point: null,
  source: 'demo', validated: true, routes: [{ vessel_id: 'USV-01' }],
  path_length_m: 12000, planned_coverage_percent: 97.5,
  estimated_duration_hours: 2.5, route_optimized: false,
};

test('规划操作只向模型传事实数据', () => {
  const report = scanPlanReport(plan, true, 3);
  assert.equal(report.status, 'completed');
  assert.equal(report.path_length_m, 12000);
  assert.equal(report.vessel_count, 1);
  assert.equal(report.requested_radius_km, 3);
  assert.equal(typeof report, 'object');
});

test('断线重试仅接受与请求坐标匹配的已保存方案', () => {
  assert.equal(scanMatchesCoordinates(plan, { startPoint: [119.69, 25.54], bounds: plan.bounds }), true);
  assert.equal(scanMatchesCoordinates(plan, { startPoint: [119.70, 25.54] }), false);
});
