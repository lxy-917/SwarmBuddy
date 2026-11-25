import { EXAMPLE_SCAN_SPEED_KNOTS } from './scanSpeed';
import type { ScanRequest } from '@/api/missionScan';

export const SCAN_ROUTE_COLORS = ['#71ceef', '#75ddbd', '#efc87d', '#c2a3e8', '#f29ba9', '#83adef', '#d6df81', '#e9acdd'];

export const DEFAULT_SCAN: ScanRequest = {
	west: 119.68,
	south: 25.53,
	east: 119.72,
	north: 25.57,
	spacing_m: 350,
	obstacle_buffer_m: 40,
	vessel_count: 3,
	speed_knots: EXAMPLE_SCAN_SPEED_KNOTS,
};

export function hasDemoCoastline(bounds: Pick<ScanRequest, 'west' | 'south' | 'east' | 'north'>) {
	return 118.5 <= bounds.west && bounds.west < bounds.east && bounds.east <= 124.8
		&& 21.7 <= bounds.south && bounds.south < bounds.north && bounds.north <= 26.1;
}
