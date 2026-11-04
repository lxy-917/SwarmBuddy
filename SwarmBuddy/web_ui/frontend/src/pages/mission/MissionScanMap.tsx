import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, WheelEvent } from 'react';

import { routeSplit, simulationAssets, simulationRiskAreas } from './missionCooperationSimulation';
import { UavIcon, UsvIcon } from './MissionPlatformIcons';
import type { CooperationSimulation } from './missionCooperationSimulation';
import { loadSatelliteTile, visibleSatelliteTiles } from './satelliteTiles';
import type { MarineConditions, ScanResult } from '@/api/missionScan';

const points = (ring: number[][]) => ring.map(([x, y]) => `${x},${y}`).join(' ');
// 扫描作业线通常重合，只标出优化后消失的旧连接段，方便辨认改动。
function removedRouteEdges(before: number[][] | undefined, after: number[][]): number[][][] {
	if (!before) return [];
	const pointKey = ([x, y]: number[]) => `${x.toFixed(2)},${y.toFixed(2)}`;
	const edgeKey = (left: number[], right: number[]) => [pointKey(left), pointKey(right)].sort().join('|');
	const current = new Set(after.slice(1).map((point, index) => edgeKey(after[index], point)));
	return before.slice(1).flatMap((point, index) =>
		current.has(edgeKey(before[index], point)) ? [] : [[before[index], point]]);
}
type Viewport = { x: number; y: number; width: number; height: number };
const INITIAL_VIEW: Viewport = { x: 0, y: 0, width: 1000, height: 625 };

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function tickStep(span: number, targetCount: number) {
	const rough = span / targetCount;
	const magnitude = 10 ** Math.floor(Math.log10(rough));
	const normalized = rough / magnitude;
	return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

function coordinateTicks(min: number, max: number, targetCount: number) {
	const step = Math.max(0.01, tickStep(max - min, targetCount));
	const ticks: number[] = [];
	for (let index = Math.ceil(min / step); index * step <= max + step * 1e-6; index += 1) {
		ticks.push(Number((index * step).toFixed(6)));
	}
	return ticks;
}

function coordinateLabel(value: number, positive: string, negative: string) {
	return `${Math.abs(value).toFixed(2)}°${value < 0 ? negative : positive}`;
}

function hoverCoordinateLabel(value: number, positive: string, negative: string) {
	return `${Math.abs(value).toFixed(4)}°${value < 0 ? negative : positive}`;
}

// 聊天流式回复会频繁更新父组件；扫描数据未变时避免重绘整张地图。
export const MissionScanMap = memo(function MissionScanMap({ result, conditions, cooperation }: { result: ScanResult; conditions?: MarineConditions | null; cooperation?: CooperationSimulation }) {
	const [view, setView] = useState<Viewport>(INITIAL_VIEW);
	const [svgSize, setSvgSize] = useState({ width: 1000, height: 625 });
	const [mapHover, setMapHover] = useState<{ x: number; y: number; longitude: number; latitude: number } | null>(null);
	const [pinnedPoint, setPinnedPoint] = useState<{ x: number; y: number; longitude: number; latitude: number } | null>(null);
	const [tileSources, setTileSources] = useState<Record<string, string>>({});
	const [satelliteUnavailable, setSatelliteUnavailable] = useState(false);
	const svgRef = useRef<SVGSVGElement>(null);
	const drag = useRef<{ x: number; y: number; view: Viewport } | null>(null);
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const updateSize = () => {
			const bounds = svg.getBoundingClientRect();
			if (bounds.width > 0 && bounds.height > 0) setSvgSize({ width: bounds.width, height: bounds.height });
		};
		const observer = new ResizeObserver(updateSize);
		observer.observe(svg);
		updateSize();
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		setMapHover(null);
		setPinnedPoint(null);
	}, [result]);
	const { mapWest, mapEast, mapNorth, mapSouth } = useMemo(() => {
		let mapWest = Infinity;
		let mapEast = -Infinity;
		let mapNorth = Infinity;
		let mapSouth = -Infinity;
		for (const ring of result.map.region) {
			for (const [x, y] of ring) {
				mapWest = Math.min(mapWest, x);
				mapEast = Math.max(mapEast, x);
				mapNorth = Math.min(mapNorth, y);
				mapSouth = Math.max(mapSouth, y);
			}
		}
		return { mapWest, mapEast, mapNorth, mapSouth };
	}, [result.map.region]);
	const { west, east, south, north } = result.bounds;
	const hasProjection = mapEast > mapWest && mapSouth > mapNorth && east > west && north > south;
	// 保持地图坐标比例，并将可见范围扩展到面板边缘，避免窄屏时卫星底图上下留白。
	const displayView = useMemo<Viewport>(() => {
		const panelRatio = svgSize.width / Math.max(1, svgSize.height);
		const viewRatio = view.width / view.height;
		if (panelRatio < viewRatio) {
			const height = view.width / panelRatio;
			return { x: view.x, y: view.y - (height - view.height) / 2, width: view.width, height };
		}
		const width = view.height * panelRatio;
		return { x: view.x - (width - view.width) / 2, y: view.y, width, height: view.height };
	}, [svgSize.width, svgSize.height, view]);
	const screenScale = Math.max(0.001, svgSize.width / displayView.width);
	const satelliteTiles = useMemo(() => {
		if (!hasProjection) return [];
		const visibleWest = west + (displayView.x - mapWest) / (mapEast - mapWest) * (east - west);
		const visibleEast = west + (displayView.x + displayView.width - mapWest) / (mapEast - mapWest) * (east - west);
		const visibleNorth = north - (displayView.y - mapNorth) / (mapSouth - mapNorth) * (north - south);
		const visibleSouth = north - (displayView.y + displayView.height - mapNorth) / (mapSouth - mapNorth) * (north - south);
		return visibleSatelliteTiles({ west: visibleWest, east: visibleEast, north: visibleNorth, south: visibleSouth }, svgSize.width);
	}, [hasProjection, west, east, north, south, mapWest, mapEast, mapNorth, mapSouth, displayView, svgSize.width]);
	useEffect(() => {
		let active = true;
		if (!satelliteTiles.length) return;
		let failures = 0;
		for (const tile of satelliteTiles) {
			loadSatelliteTile(tile).then((source) => {
				if (active) setTileSources((current) => current[tile.key] ? current : { ...current, [tile.key]: source });
			}).catch(() => {
				failures += 1;
				if (active && failures === satelliteTiles.length) setSatelliteUnavailable(true);
			});
		}
		return () => { active = false; };
	}, [satelliteTiles]);
	const startWaypoint = result.map.waypoints[0];
	const simulationMarkers = cooperation && (cooperation.second > 0 || cooperation.running) ? simulationAssets(result, cooperation) : [];
	const simulationSplit = simulationMarkers.length ? routeSplit(result.map.waypoints) : 0;
	const riskAreas = useMemo(() => simulationRiskAreas(result), [result]);
	const endWaypoint = result.map.waypoints.length > 1 ? result.map.waypoints[result.map.waypoints.length - 1] : undefined;
	const oldConnections = useMemo(() => removedRouteEdges(
		result.map.baseline_waypoints, result.map.waypoints,
	), [result.map.baseline_waypoints, result.map.waypoints]);
	const plot = {
		left: displayView.x + Math.min(displayView.width * 0.3, 70 / screenScale),
		right: displayView.x + displayView.width - Math.min(displayView.width * 0.15, 30 / screenScale),
		top: displayView.y + Math.min(displayView.height * 0.32, 70 / screenScale),
		bottom: displayView.y + displayView.height - Math.min(displayView.height * 0.2, 45 / screenScale),
	};
	const geoLongitude = (x: number) => west + (x - mapWest) / (mapEast - mapWest) * (east - west);
	const geoLatitude = (y: number) => north - (y - mapNorth) / (mapSouth - mapNorth) * (north - south);
	const longitudeX = (value: number) => mapWest + (value - west) / (east - west) * (mapEast - mapWest);
	const latitudeY = (value: number) => mapNorth + (north - value) / (north - south) * (mapSouth - mapNorth);
	const samplePositions = conditions && hasProjection ? conditions.samples.filter((sample) => sample.longitude >= west && sample.longitude <= east && sample.latitude >= south && sample.latitude <= north)
		.map((sample) => ({ x: longitudeX(sample.longitude), y: latitudeY(sample.latitude), ...sample })) : [];
	const longitudeScale = hasProjection ? coordinateTicks(geoLongitude(plot.left), geoLongitude(plot.right), 5) : null;
	const latitudeScale = hasProjection ? coordinateTicks(geoLatitude(plot.bottom), geoLatitude(plot.top), 4) : null;
	const longitudes = longitudeScale?.filter((value) => value >= -180 && value <= 180).map((value) => ({ value, x: longitudeX(value) })) ?? [];
	const latitudes = latitudeScale?.filter((value) => value >= -90 && value <= 90).map((value) => ({ value, y: latitudeY(value) })) ?? [];
	const pinnedVisible = pinnedPoint && pinnedPoint.x >= displayView.x && pinnedPoint.x <= displayView.x + displayView.width && pinnedPoint.y >= displayView.y && pinnedPoint.y <= displayView.y + displayView.height;
	const pinnedCardWidth = 180 / screenScale;
	const pinnedCardHeight = 71 / screenScale;
	const pinnedCardX = pinnedPoint ? clamp(
		pinnedPoint.x + (pinnedPoint.x + 194 / screenScale > displayView.x + displayView.width ? -194 : 14) / screenScale,
		displayView.x + 8 / screenScale,
		displayView.x + displayView.width - pinnedCardWidth - 8 / screenScale,
	) : 0;
	const pinnedCardY = pinnedPoint ? clamp(
		pinnedPoint.y + (pinnedPoint.y + 85 / screenScale > displayView.y + displayView.height ? -85 : 14) / screenScale,
		displayView.y + 8 / screenScale,
		displayView.y + displayView.height - pinnedCardHeight - 8 / screenScale,
	) : 0;
	const coordinateAt = (svg: SVGSVGElement, clientX: number, clientY: number) => {
		if (!hasProjection) return null;
		const matrix = svg.getScreenCTM();
		if (!matrix) return null;
		const cursor = svg.createSVGPoint();
		cursor.x = clientX;
		cursor.y = clientY;
		const point = cursor.matrixTransform(matrix.inverse());
		const longitude = geoLongitude(point.x);
		const latitude = geoLatitude(point.y);
		if (point.x < displayView.x || point.x > displayView.x + displayView.width || point.y < displayView.y || point.y > displayView.y + displayView.height || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
		return { x: point.x, y: point.y, longitude, latitude };
	};

	const zoom = (factor: number) => {
		setView((current) => {
			const width = clamp(current.width / factor, 125, 1000);
			const height = width * 0.625;
			const centerX = current.x + current.width / 2;
			const centerY = current.y + current.height / 2;
			return {
				x: clamp(centerX - width / 2, 0, 1000 - width),
				y: clamp(centerY - height / 2, 0, 625 - height),
				width, height,
			};
		});
	};

	const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
		if (view.width === 1000) return;
		drag.current = { x: event.clientX, y: event.clientY, view };
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
		const coordinate = coordinateAt(event.currentTarget, event.clientX, event.clientY);
		const rect = event.currentTarget.getBoundingClientRect();
		setMapHover(coordinate ? { x: event.clientX - rect.left, y: event.clientY - rect.top, longitude: coordinate.longitude, latitude: coordinate.latitude } : null);
		if (!drag.current) return;
		const { x, y, view: start } = drag.current;
		const bounds = event.currentTarget.getBoundingClientRect();
		setView({
			...start,
			x: clamp(start.x - (event.clientX - x) * displayView.width / bounds.width, 0, 1000 - start.width),
			y: clamp(start.y - (event.clientY - y) * displayView.height / bounds.height, 0, 625 - start.height),
		});
	};
	const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
		drag.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
	};
	const wheel = (event: WheelEvent<SVGSVGElement>) => {
		event.preventDefault();
		zoom(event.deltaY < 0 ? 1.25 : 0.8);
	};
	const pinCoordinate = (event: MouseEvent<SVGSVGElement>) => {
		event.preventDefault();
		const coordinate = coordinateAt(event.currentTarget, event.clientX, event.clientY);
		if (coordinate) {
			setPinnedPoint(coordinate);
			setMapHover(null);
		}
	};
	const unpinCoordinate = (event: MouseEvent<SVGSVGElement>) => {
		if (!pinnedPoint) return;
		event.preventDefault();
		setPinnedPoint(null);
	};

	return <>
		<svg
			ref={svgRef}
			className="map-overlay mission-real-scan-map"
			viewBox={`${displayView.x} ${displayView.y} ${displayView.width} ${displayView.height}`}
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label="带经纬度刻度的海域扫描航迹，悬停查看坐标，双击固定坐标，右击取消固定，可缩放和平移"
			onWheel={wheel}
			onMouseDown={(event) => event.preventDefault()}
			onPointerDown={pointerDown}
			onPointerMove={pointerMove}
			onPointerUp={pointerUp}
			onPointerCancel={pointerUp}
			onPointerLeave={() => setMapHover(null)}
			onDoubleClick={pinCoordinate}
			onContextMenu={unpinCoordinate}
		>
			<defs>
				<clipPath id="mission-satellite-clip"><rect x={displayView.x} y={displayView.y} width={displayView.width} height={displayView.height} /></clipPath>
			</defs>
			<rect x={displayView.x} y={displayView.y} width={displayView.width} height={displayView.height} fill="#092535" />
			{hasProjection && <g clipPath="url(#mission-satellite-clip)" aria-hidden="true">
				{satelliteTiles.map((tile) => tileSources[tile.key] && <image
					key={tile.key}
					href={tileSources[tile.key]}
					x={longitudeX(tile.west)}
					y={latitudeY(tile.north)}
					width={longitudeX(tile.east) - longitudeX(tile.west)}
					height={latitudeY(tile.south) - latitudeY(tile.north)}
					preserveAspectRatio="none"
				/>)}
			</g>}
			{satelliteUnavailable && !satelliteTiles.some((tile) => tileSources[tile.key]) && <text x={displayView.x + displayView.width / 2} y={displayView.y + displayView.height / 2} textAnchor="middle" fill="#c7dce5" fontSize={16 / screenScale}>卫星影像暂时无法加载</text>}
			{hasProjection && <g className="mission-map-graticule" aria-hidden="true">
				<rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} />
				{longitudes.map(({ value, x }) => <line key={`longitude-${value}`} x1={x} x2={x} y1={plot.top} y2={plot.bottom} />)}
				{latitudes.map(({ value, y }) => <line key={`latitude-${value}`} x1={plot.left} x2={plot.right} y1={y} y2={y} />)}
			</g>}
			{result.map.context_obstacles?.map((ring, index) => <polygon key={`context-island-${index}`} className="mission-map-context-island" points={points(ring)} fill="#d5bd83" fillOpacity=".055" stroke="#e1cf9f" strokeWidth=".9" strokeOpacity=".52" strokeDasharray="3 4" />)}
			{result.map.region.map((ring, index) => <polygon key={`region-${index}`} className="mission-map-region" points={points(ring)} fill="#23a9cc" fillOpacity=".055" stroke="#7bd1df" strokeOpacity=".75" strokeWidth="1.4" strokeDasharray="5 5" />)}
			{result.map.obstacles.map((ring, index) => <polygon key={`island-${index}`} points={points(ring)} fill="none" stroke="#f3c783" strokeWidth="1.2" strokeOpacity=".86" strokeDasharray="4 3" />)}
			{result.map.no_go_zones?.map((ring, index) => <polygon key={`restricted-${index}`} className="mission-map-no-go-zone" points={points(ring)} fill="#ef4d62" fillOpacity=".17" stroke="#ff697d" strokeOpacity=".88" strokeWidth="2" strokeDasharray="7 5" />)}
			<g className="mission-sim-risk-areas" clipPath="url(#mission-satellite-clip)">
				{riskAreas.map((area) => <g key={area.id}>
					<polygon points={points(area.polygon)} />
					<circle cx={area.center[0]} cy={area.center[1]} r={7 / screenScale} />
					<text x={area.center[0] + 10 / screenScale} y={area.center[1] + 4 / screenScale} fontSize={11 / screenScale} strokeWidth={3 / screenScale}>高风险区域</text>
					<title>高风险区域</title>
				</g>)}
			</g>
			{oldConnections.map((edge, index) => <polyline key={`old-route-${index}`} points={points(edge)} fill="none" stroke="#ffbd73" strokeWidth="2.4" strokeDasharray="5 4" strokeOpacity=".92" />)}
			<polyline className="scan-routes" points={points(result.map.waypoints)} fill="none" stroke="#80d4ff" strokeWidth="2.3" strokeLinejoin="round" strokeLinecap="round" />
			{simulationMarkers.length > 0 && <g className="scan-routes" fill="none" strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round" opacity=".9">
				<polyline points={points(result.map.waypoints.slice(0, simulationSplit + 1))} stroke="#79dfff" />
				<polyline points={points(result.map.waypoints.slice(simulationSplit))} stroke="#72e0be" />
			</g>}
			{simulationMarkers.map((asset) => <g key={asset.id} className={`mission-sim-map-asset ${asset.kind}`} transform={`translate(${asset.position[0]} ${asset.position[1]})`}>
				<circle r="14" fill="#063855" fillOpacity=".68" stroke={asset.kind === 'uav' ? '#6ad7ff' : '#79e7cb'} strokeOpacity=".65" strokeWidth="1" />
				{asset.kind === 'uav' ? <UavIcon x={-11} y={-11} width={22} height={22} color="#6be2ff" /> : <UsvIcon x={-11} y={-11} width={22} height={22} color="#9bf4e0" />}
				<text x="19" y="4" fill="#ecfcff" stroke="#062335" strokeWidth="3" paintOrder="stroke" fontSize="11" fontWeight="700">{asset.id}</text>
				<title>{asset.id} · {asset.status} · 仿真位置</title>
			</g>)}
			{cooperation?.target && <g className="mission-sim-map-target" transform={`translate(${cooperation.target[0]} ${cooperation.target[1]})`}>
				<circle r="18" fill="none" stroke={cooperation.targetStatus === 'confirmed' ? '#60ddb2' : '#ffad5d'} strokeWidth="2" strokeDasharray="4 3" />
				<circle r="5" fill={cooperation.targetStatus === 'confirmed' ? '#60ddb2' : '#ffad5d'} />
				<title>训练目标 · {cooperation.targetStatus === 'confirmed' ? '已复核' : '待复核'} · 仿真</title>
			</g>}
			{startWaypoint && <g className="mission-map-start-marker">
				<circle cx={startWaypoint[0]} cy={startWaypoint[1]} r="11" fill="#64d8bd" fillOpacity=".22" />
				<circle cx={startWaypoint[0]} cy={startWaypoint[1]} r="6.5" fill="#64d8bd" stroke="#f4fff9" strokeWidth="2">
					<title>起点{result.start_point ? `：${hoverCoordinateLabel(result.start_point[0], 'E', 'W')}、${hoverCoordinateLabel(result.start_point[1], 'N', 'S')}` : ''}</title>
				</circle>
			</g>}
			{endWaypoint && <g className="mission-map-end-marker">
				<circle cx={endWaypoint[0]} cy={endWaypoint[1]} r="11" fill="#f0b377" fillOpacity=".22" />
				<circle cx={endWaypoint[0]} cy={endWaypoint[1]} r="6.5" fill="#f0b377" stroke="#fff4e8" strokeWidth="2">
					<title>终点{result.end_point ? `：${hoverCoordinateLabel(result.end_point[0], 'E', 'W')}、${hoverCoordinateLabel(result.end_point[1], 'N', 'S')}` : ''}</title>
				</circle>
			</g>}
			{samplePositions.map((sample, index) => <g key={`weather-sample-${index}`} className="mission-map-weather-sample" aria-label="海况预报采样点">
				<circle cx={sample.x} cy={sample.y} r="13" fill="#1aa9c6" fillOpacity=".16" stroke="#7de4e6" strokeOpacity=".45" strokeWidth="1" />
				<circle cx={sample.x} cy={sample.y} r="4" fill="#f3d48e" stroke="#fff3d4" strokeWidth="1.5"><title>海况采样坐标 [{sample.longitude}, {sample.latitude}]（经度, 纬度）</title></circle>
			</g>)}
			{hasProjection && <g className="mission-map-axis-labels" aria-hidden="true" fontSize={12 / screenScale} style={{ strokeWidth: 3 / screenScale }}>
				{longitudes.map(({ value, x }) => <text key={`longitude-label-${value}`} x={x} y={plot.bottom + 21 / screenScale} textAnchor="middle">{coordinateLabel(value, 'E', 'W')}</text>)}
				{latitudes.map(({ value, y }) => <text key={`latitude-label-${value}`} x={plot.left - 12 / screenScale} y={y} textAnchor="end" dominantBaseline="middle">{coordinateLabel(value, 'N', 'S')}</text>)}
			</g>}
			{pinnedVisible && <g className="mission-map-pinned-point" aria-label={`固定坐标：经度 ${hoverCoordinateLabel(pinnedPoint.longitude, 'E', 'W')}，纬度 ${hoverCoordinateLabel(pinnedPoint.latitude, 'N', 'S')}`}>
				<circle cx={pinnedPoint.x} cy={pinnedPoint.y} r={6 / screenScale} strokeWidth={2 / screenScale} />
				<rect x={pinnedCardX} y={pinnedCardY} width={pinnedCardWidth} height={pinnedCardHeight} rx={7 / screenScale} strokeWidth={1 / screenScale} />
				<text className="mission-map-pinned-title" x={pinnedCardX + 10 / screenScale} y={pinnedCardY + 17 / screenScale} fontSize={10 / screenScale}>固定点 · 右击取消</text>
				<text x={pinnedCardX + 10 / screenScale} y={pinnedCardY + 37 / screenScale} fontSize={11 / screenScale}>经度 {hoverCoordinateLabel(pinnedPoint.longitude, 'E', 'W')}</text>
				<text x={pinnedCardX + 10 / screenScale} y={pinnedCardY + 56 / screenScale} fontSize={11 / screenScale}>纬度 {hoverCoordinateLabel(pinnedPoint.latitude, 'N', 'S')}</text>
			</g>}
		</svg>
		{mapHover && <div className="mission-map-hover-coordinate" style={{ left: mapHover.x + 174 <= svgSize.width ? mapHover.x + 14 : Math.max(8, mapHover.x - 174), top: mapHover.y + 70 <= svgSize.height ? mapHover.y + 14 : Math.max(8, mapHover.y - 64) }} aria-hidden="true">
			<span>经度 <strong>{hoverCoordinateLabel(mapHover.longitude, 'E', 'W')}</strong></span>
			<span>纬度 <strong>{hoverCoordinateLabel(mapHover.latitude, 'N', 'S')}</strong></span>
		</div>}
		<div className="mission-map-zoom" aria-label="缩放扫描结果">
			<button type="button" aria-label="放大扫描结果" onClick={() => zoom(1.25)}>＋</button>
			<button type="button" aria-label="缩小扫描结果" onClick={() => zoom(0.8)} disabled={view.width === 1000}>－</button>
			<button type="button" aria-label="重置扫描结果缩放" onClick={() => setView(INITIAL_VIEW)} disabled={view.width === 1000}>重置</button>
		</div>
	</>;
});
