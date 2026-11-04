import { EXAMPLE_SCAN_SPEED_KNOTS } from './scanSpeed';
import type { ScanRequest } from '@/api/missionScan';

export const DEFAULT_SCAN: ScanRequest = {
	west: 119.68,
	south: 25.53,
	east: 119.72,
	north: 25.57,
	spacing_m: 350,
	obstacle_buffer_m: 40,
	speed_knots: EXAMPLE_SCAN_SPEED_KNOTS,
};
