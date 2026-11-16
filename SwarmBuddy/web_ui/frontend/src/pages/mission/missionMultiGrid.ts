import type { SimulationAsset, SimulationPoint } from './missionCooperationSimulation';

// pSearchGrid 思路的本地试验：记录艇位经过网格的时间，不代表传感器已完成探测。
export const MULTIGRID_CELL_SIZE = 24;

export type MultiGridCell = {
	column: number;
	row: number;
	seconds: number;
	vesselIds: string[];
};

export type MultiGridState = {
	cells: Record<string, MultiGridCell>;
	lastPositions: Record<string, SimulationPoint>;
	lastSecond: number;
};

export function multiGridInitial(second = 0): MultiGridState {
	return { cells: {}, lastPositions: {}, lastSecond: second };
}

export function advanceMultiGrid(state: MultiGridState, assets: SimulationAsset[], second: number): MultiGridState {
	if (!Number.isFinite(second) || second <= state.lastSecond) return state;
	const elapsed = Math.min(second - state.lastSecond, 1);
	const cells = { ...state.cells };
	const lastPositions = { ...state.lastPositions };
	for (const asset of assets) {
		if (asset.kind !== 'usv' || asset.status === '失联') continue;
		const from = lastPositions[asset.id] ?? asset.position;
		const distance = Math.hypot(asset.position[0] - from[0], asset.position[1] - from[1]);
		const steps = Math.max(1, Math.ceil(distance / (MULTIGRID_CELL_SIZE / 2)));
		for (let step = 1; step <= steps; step++) {
			const fraction = step / steps;
			const column = Math.floor((from[0] + (asset.position[0] - from[0]) * fraction) / MULTIGRID_CELL_SIZE);
			const row = Math.floor((from[1] + (asset.position[1] - from[1]) * fraction) / MULTIGRID_CELL_SIZE);
			const key = `${column}:${row}`;
			const previous = cells[key];
			cells[key] = {
				column, row,
				seconds: (previous?.seconds ?? 0) + elapsed / steps,
				vesselIds: previous?.vesselIds.includes(asset.id) ? previous.vesselIds : [...(previous?.vesselIds ?? []), asset.id],
			};
		}
		lastPositions[asset.id] = asset.position;
	}
	return { cells, lastPositions, lastSecond: second };
}

export function multiGridSummary(state: MultiGridState) {
	const cells = Object.values(state.cells);
	return {
		visitedCells: cells.length,
		sharedCells: cells.filter((cell) => cell.vesselIds.length > 1).length,
		vesselSeconds: cells.reduce((total, cell) => total + cell.seconds, 0),
	};
}
