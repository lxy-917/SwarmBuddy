import type { SimulationPoint } from './missionCooperationSimulation';

export function radarContactPosition(origin: SimulationPoint, location: SimulationPoint, metersPerUnit: number, rangeMeters: number, radius: number, center: number) {
	const x = (location[0] - origin[0]) * metersPerUnit;
	const y = (location[1] - origin[1]) * metersPerUnit;
	const distance = Math.hypot(x, y);
	return { x: center + x / rangeMeters * radius, y: center + y / rangeMeters * radius, distance, visible: distance <= rangeMeters };
}
