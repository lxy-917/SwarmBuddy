import { useEffect, useMemo, useState } from 'react';

import { createGame, gameScore, stepGame } from './missionGame';
import type { GameConfig, GameState } from './missionGame';
import { DEFAULT_SCAN } from './scanDefaults';
import { loadSatelliteTile, visibleSatelliteTiles } from './satelliteTiles';
import type { ScanResult } from '@/api/missionScan';

const startingConfig: GameConfig = { redCount: 3, blueCount: 3, seed: 2026, redStrategy: 'coordinate', blueStrategy: 'coverage' };

const imageCredit = 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)';

function GameSatelliteMap({ game, result }: { game: GameState; result: ScanResult | null }) {
	const [tileSources, setTileSources] = useState<Record<string, string>>({});
	const [unavailable, setUnavailable] = useState(false);
	const projection = useMemo(() => {
		const bounds = result?.bounds ?? DEFAULT_SCAN;
		const points = result?.map.region.flat() ?? [];
		const xs = points.map((point) => point[0]);
		const ys = points.map((point) => point[1]);
		const mapWest = xs.length ? Math.min(...xs) : 0;
		const mapEast = xs.length ? Math.max(...xs) : 1000;
		const mapNorth = ys.length ? Math.min(...ys) : 0;
		const mapSouth = ys.length ? Math.max(...ys) : 625;
		if (!(mapEast > mapWest && mapSouth > mapNorth && bounds.east > bounds.west && bounds.north > bounds.south)) return null;
		const longitudeX = (longitude: number) => mapWest + (longitude - bounds.west) / (bounds.east - bounds.west) * (mapEast - mapWest);
		const latitudeY = (latitude: number) => mapNorth + (bounds.north - latitude) / (bounds.north - bounds.south) * (mapSouth - mapNorth);
		const visible = {
			west: bounds.west + (0 - mapWest) / (mapEast - mapWest) * (bounds.east - bounds.west),
			east: bounds.west + (1000 - mapWest) / (mapEast - mapWest) * (bounds.east - bounds.west),
			north: bounds.north - (0 - mapNorth) / (mapSouth - mapNorth) * (bounds.north - bounds.south),
			south: bounds.north - (625 - mapNorth) / (mapSouth - mapNorth) * (bounds.north - bounds.south),
		};
		return { tiles: visibleSatelliteTiles(visible, 1000), longitudeX, latitudeY };
	}, [result]);
	const tiles = projection?.tiles ?? [];
	useEffect(() => {
		let active = true;
		let failures = 0;
		setUnavailable(false);
		for (const tile of tiles) {
			loadSatelliteTile(tile).then((source) => {
				if (active) setTileSources((current) => current[tile.key] ? current : { ...current, [tile.key]: source });
			}).catch(() => {
				failures += 1;
				if (active && failures === tiles.length) setUnavailable(true);
			});
		}
		return () => { active = false; };
	}, [tiles]);
	const polygonPoints = (ring: number[][]) => ring.map(([x, y]) => `${x},${y}`).join(' ');
	return <div className="mission-game-map-frame">
		<svg className="mission-game-map" viewBox="0 0 1000 625" role="img" aria-label="卫星地图上的红蓝两队搜寻博弈">
			<rect width="1000" height="625" fill="#06263a" />
			{projection?.tiles.map((tile) => tileSources[tile.key] && <image key={tile.key} href={tileSources[tile.key]}
				x={projection.longitudeX(tile.west)} y={projection.latitudeY(tile.north)}
				width={projection.longitudeX(tile.east) - projection.longitudeX(tile.west)}
				height={projection.latitudeY(tile.south) - projection.latitudeY(tile.north)} preserveAspectRatio="none" />)}
			{unavailable && !tiles.some((tile) => tileSources[tile.key]) && <text x="500" y="310" textAnchor="middle" fill="#d9e9ee" fontSize="20">卫星影像暂时无法加载</text>}
			{result?.map.coastline_land?.map((ring, index) => <polygon key={`land-${index}`} points={polygonPoints(ring)} fill="#142e29" fillOpacity=".5" />)}
			{result?.map.no_go_zones?.map((ring, index) => <polygon key={`restricted-${index}`} points={polygonPoints(ring)} fill="#ef4d62" fillOpacity=".17" stroke="#ff697d" strokeWidth="2" strokeDasharray="7 5" />)}
			{Array.from({ length: 15 }, (_, index) => <line key={`v-${index}`} x1={(index + 1) * 62.5} x2={(index + 1) * 62.5} y1="0" y2="625" stroke="#d9f7ff" strokeOpacity=".13" strokeWidth="1" />)}
			{Array.from({ length: 9 }, (_, index) => <line key={`h-${index}`} x1="0" x2="1000" y1={(index + 1) * 62.5} y2={(index + 1) * 62.5} stroke="#d9f7ff" strokeOpacity=".13" strokeWidth="1" />)}
			{game.targets.filter((target) => game.turn >= game.maxTurns || target.foundBy.length > 0).map((target) => <g key={target.id}><circle cx={target.x} cy={target.y} r="14" fill={target.claimedBy === 'red' ? '#ed746b' : target.claimedBy === 'blue' ? '#6bbdff' : '#f4ca69'} stroke="#fff" strokeWidth="2" /><text x={target.x + 19} y={target.y + 5} fill="#fff" stroke="#06263a" strokeWidth="3" paintOrder="stroke" fontSize="18">{target.id}{game.turn >= game.maxTurns ? target.real ? ' ✓' : ' ×' : ''}</text></g>)}
			{game.boats.map((boat) => <g key={boat.id}><circle cx={boat.x} cy={boat.y} r="12" fill={boat.side === 'red' ? '#f26464' : '#4caeff'} stroke="#fff" strokeWidth="2" /><text x={boat.x + 16} y={boat.y + 5} fill="#fff" stroke="#06263a" strokeWidth="3" paintOrder="stroke" fontSize="17">{boat.id}</text></g>)}
		</svg>
		<div className="mission-game-map-credit"><span>{result ? '当前规划海域' : '默认演示海域'} · 卫星影像</span><span>{imageCredit}</span></div>
	</div>;
}

export function MissionGamePanel({ result = null }: { result?: ScanResult | null }) {
	const [config, setConfig] = useState<GameConfig>(startingConfig);
	const [game, setGame] = useState(() => createGame(startingConfig));
	const [playing, setPlaying] = useState(false);
	const finished = game.turn >= game.maxTurns;
	useEffect(() => {
		if (!playing || finished) return;
		const timer = window.setInterval(() => setGame((current) => stepGame(current)), 550);
		return () => window.clearInterval(timer);
	}, [playing, finished]);
	const red = gameScore(game, 'red');
	const blue = gameScore(game, 'blue');
	const restart = () => { setPlaying(false); setGame(createGame(config)); };
	return <div className="mission-game-panel" role="tabpanel" aria-label="智能博弈">
		<div className="mission-game-heading"><div><strong>海域搜寻博弈</strong><p>红蓝两队分别协作搜索；目标真值在核查前对双方隐藏。当前使用可复现的规则策略智能体。</p></div><span>第 {game.turn} / {game.maxTurns} 轮</span></div>
		<div className="mission-game-controls">
			<label>红队艇数<input aria-label="红队艇数" type="number" min="1" max="8" value={config.redCount} onChange={(event) => setConfig((current) => ({ ...current, redCount: Number(event.target.value) }))} /></label>
			<label>红队策略<select aria-label="红队策略" value={config.redStrategy} onChange={(event) => setConfig((current) => ({ ...current, redStrategy: event.target.value as GameConfig['redStrategy'] }))}><option value="coordinate">协同复核</option><option value="coverage">覆盖优先</option></select></label>
			<label>蓝队艇数<input aria-label="蓝队艇数" type="number" min="1" max="8" value={config.blueCount} onChange={(event) => setConfig((current) => ({ ...current, blueCount: Number(event.target.value) }))} /></label>
			<label>蓝队策略<select aria-label="蓝队策略" value={config.blueStrategy} onChange={(event) => setConfig((current) => ({ ...current, blueStrategy: event.target.value as GameConfig['blueStrategy'] }))}><option value="coordinate">协同复核</option><option value="coverage">覆盖优先</option></select></label>
			<label>随机种子<input aria-label="随机种子" type="number" value={config.seed} onChange={(event) => setConfig((current) => ({ ...current, seed: Number(event.target.value) }))} /></label>
			<button type="button" onClick={restart}>按当前配置重置</button>
			<button type="button" disabled={finished} onClick={() => setGame((current) => stepGame(current))}>推进一轮</button>
			<button type="button" disabled={finished} onClick={() => setPlaying((current) => !current)}>{playing ? '暂停' : '自动运行'}</button>
		</div>
		<div className="mission-game-scoreboard" aria-live="polite">
			<div className="red"><strong>红队 · {game.config.redCount} 艘</strong><b>{red.points} 分</b><span>真实目标 {red.captures} · 误报复核 {red.falseAlarms} · 网格 {red.coverage}</span></div>
			<div className="blue"><strong>蓝队 · {game.config.blueCount} 艘</strong><b>{blue.points} 分</b><span>真实目标 {blue.captures} · 误报复核 {blue.falseAlarms} · 网格 {blue.coverage}</span></div>
		</div>
		<details className="mission-game-roster"><summary>查看逐艇贡献</summary><div>{game.boats.map((boat) => <span key={boat.id}>{boat.id} · 有效核查 {boat.verifiedTrue} · 误报 {boat.verifiedFalse} · 经过网格 {boat.cells.length}</span>)}</div></details>
		<div className="mission-game-layout">
			<GameSatelliteMap game={game} result={result} />
			<div className="mission-game-events"><strong>事件轨迹</strong>{game.events.length ? game.events.slice(0, 16).map((event, index) => <p key={`${event.turn}-${event.side}-${index}`}><span>第 {event.turn} 轮 · {event.side === 'red' ? '红队' : '蓝队'}</span>{event.text}</p>) : <p>推进一轮后显示发现与核查事件。</p>}{finished && <p><strong>本局结束：</strong>{red.points === blue.points ? '平局' : red.points > blue.points ? '红队得分更高' : '蓝队得分更高'}</p>}</div>
		</div>
		<p className="mission-game-note">计分：真实目标 +50，覆盖网格 +2，误报复核 −12，航行距离每 100 单位 −1。艇位目前按规则仿真，尚未按海岸线与禁航区避障；此博弈尚未接入模型训练。</p>
	</div>;
}
