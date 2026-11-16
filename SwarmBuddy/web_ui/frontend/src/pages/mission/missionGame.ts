export type GameSide = 'red' | 'blue';
export type GameStrategy = 'coordinate' | 'coverage';
export type GameConfig = { redCount: number; blueCount: number; seed: number; redStrategy: GameStrategy; blueStrategy: GameStrategy };
export type GameBoat = { id: string; side: GameSide; x: number; y: number; distance: number; cells: number[]; verifiedTrue: number; verifiedFalse: number };
export type GameTarget = { id: string; x: number; y: number; real: boolean; foundBy: GameSide[]; claimedBy: GameSide | null };
export type GameEvent = { turn: number; side: GameSide; text: string };
export type GameState = { config: GameConfig; turn: number; maxTurns: number; boats: GameBoat[]; targets: GameTarget[]; events: GameEvent[] };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const cell = ({ x, y }: { x: number; y: number }) => Math.floor(clamp(y, 0, 624) / 62.5) * 16 + Math.floor(clamp(x, 0, 999) / 62.5);

function randomGenerator(seed: number) {
	let value = seed >>> 0;
	return () => {
		value = (value + 0x6D2B79F5) >>> 0;
		let next = Math.imul(value ^ (value >>> 15), 1 | value);
		next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
		return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
	};
}

export function createGame(config: GameConfig): GameState {
	const safe: GameConfig = { ...config, redCount: clamp(Math.floor(config.redCount), 1, 8), blueCount: clamp(Math.floor(config.blueCount), 1, 8), seed: Math.floor(config.seed) || 1 };
	const random = randomGenerator(safe.seed);
	const truth = [true, true, true, false, false];
	for (let index = truth.length - 1; index > 0; index--) {
		const other = Math.floor(random() * (index + 1));
		[truth[index], truth[other]] = [truth[other], truth[index]];
	}
	const targets: GameTarget[] = Array.from({ length: 5 }, (_, index) => ({
		id: `T-${index + 1}`, x: 230 + Math.round(random() * 540), y: 70 + Math.round(random() * 485),
		real: truth[index], foundBy: [], claimedBy: null,
	}));
	const boats: GameBoat[] = (['red', 'blue'] as const).flatMap((side) => {
		const count = side === 'red' ? safe.redCount : safe.blueCount;
		return Array.from({ length: count }, (_, index) => {
			const boat = { id: `${side === 'red' ? 'R' : 'B'}-${index + 1}`, side,
				x: side === 'red' ? 85 : 915, y: Math.round((index + 1) * 625 / (count + 1)), distance: 0, cells: [] as number[], verifiedTrue: 0, verifiedFalse: 0 };
			boat.cells = [cell(boat)];
			return boat;
		});
	});
	return { config: safe, turn: 0, maxTurns: 16, boats, targets, events: [] };
}

export function stepGame(previous: GameState): GameState {
	if (previous.turn >= previous.maxTurns) return previous;
	const turn = previous.turn + 1;
	const boats = previous.boats.map((boat) => ({ ...boat, cells: [...boat.cells] }));
	const targets = previous.targets.map((target) => ({ ...target, foundBy: [...target.foundBy] }));
	const events: GameEvent[] = [];
	for (const side of ['red', 'blue'] as const) {
		const team = boats.filter((boat) => boat.side === side);
		const strategy = side === 'red' ? previous.config.redStrategy : previous.config.blueStrategy;
		const assigned = new Set<string>();
		for (const boat of team) {
			const visible = targets.filter((target) => !target.claimedBy && target.foundBy.includes(side) &&
				(strategy === 'coordinate' ? !assigned.has(target.id) : distance(boat, target) < 150));
			visible.sort((left, right) => distance(boat, left) - distance(boat, right));
			const chosen = visible[0];
			if (chosen) assigned.add(chosen.id);
			events.push({ turn, side, text: `${boat.id} ${chosen ? `前往复核 ${chosen.id}` : '沿分区巡航'}` });
			const patrolX = side === 'red' ? Math.min(900, 85 + turn * 58) : Math.max(100, 915 - turn * 58);
			const destination = chosen ?? { x: patrolX, y: boat.y };
			const length = distance(boat, destination);
			const moved = Math.min(72, length);
			if (length) { boat.x += (destination.x - boat.x) * moved / length; boat.y += (destination.y - boat.y) * moved / length; }
			boat.distance += moved;
			const visited = cell(boat);
			if (!boat.cells.includes(visited)) boat.cells.push(visited);
			for (const target of targets) {
				if (target.claimedBy) continue;
				if (distance(boat, target) <= 115 && !target.foundBy.includes(side)) {
					target.foundBy.push(side);
					events.push({ turn, side, text: `${boat.id} 报告疑似目标 ${target.id}` });
				}
				if (target.foundBy.includes(side) && distance(boat, target) <= 38 && !target.claimedBy) {
					target.claimedBy = side;
					if (target.real) boat.verifiedTrue += 1;
					else boat.verifiedFalse += 1;
					events.push({ turn, side, text: `${boat.id} 核查 ${target.id}：${target.real ? '真实目标' : '误报'}` });
				}
			}
		}
	}
	return { ...previous, turn, boats, targets, events: [...events, ...previous.events] };
}

export function gameScore(state: GameState, side: GameSide) {
	const captures = state.targets.filter((target) => target.claimedBy === side && target.real).length;
	const falseAlarms = state.targets.filter((target) => target.claimedBy === side && !target.real).length;
	const coverage = new Set(state.boats.filter((boat) => boat.side === side).flatMap((boat) => boat.cells)).size;
	const distanceUnits = state.boats.filter((boat) => boat.side === side).reduce((sum, boat) => sum + boat.distance, 0);
	return { captures, falseAlarms, coverage, distanceUnits: Math.round(distanceUnits),
		points: Math.round(captures * 50 + coverage * 2 - falseAlarms * 12 - distanceUnits / 100) };
}
