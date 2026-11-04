import type { ScanRequest } from '@/api/missionScan';

type ScanBounds = Pick<ScanRequest, 'west' | 'east' | 'south' | 'north'>;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function suggestScanParameters(bounds: ScanBounds): Pick<ScanRequest, 'spacing_m' | 'obstacle_buffer_m'> | null {
	const { west, east, south, north } = bounds;
	if (![west, east, south, north].every(Number.isFinite) || west >= east || south >= north || south < -90 || north > 90) return null;
	const middleLatitude = (south + north) / 2 * Math.PI / 180;
	const widthM = (east - west) * 111_195 * Math.cos(middleLatitude);
	const heightM = (north - south) * 111_195;
	if (widthM <= 0 || heightM <= 0) return null;
	// 根据较短边控制约 40 条扫描带；这只是方案密度建议，不代表传感器实际覆盖宽度。
	const spacing_m = clamp(Math.round(Math.min(widthM, heightM) / 40 / 50) * 50, 350, 2000);
	// 缓冲距离随规划尺度小幅增加；实航还需按船体、定位误差和环境重新核定。
	const obstacle_buffer_m = clamp(Math.ceil(spacing_m * 0.05 / 5) * 5, 40, 100);
	return { spacing_m, obstacle_buffer_m };
}
