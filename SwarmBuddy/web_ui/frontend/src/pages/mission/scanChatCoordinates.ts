export type GeographicPoint = [number, number];

export type ChatScanCoordinates = {
	bounds?: { west: number; east: number; south: number; north: number };
	startPoint?: GeographicPoint;
	endPoint?: GeographicPoint;
	centerPoint?: GeographicPoint;
	radiusKm?: number;
	derivedBounds?: boolean;
	error?: string;
};


const NUMBER = '([+-]?\\d{1,3}(?:\\.\\d+)?)';
const COORDINATE = `${NUMBER}\\s*(?:°|度)?\\s*([EWNS东西南北])?`;

function labelled(text: string, label: string): number | null {
	const match = text.match(new RegExp(`(?:${label})\\s*[:：]?\\s*${NUMBER}`, 'i'));
	return match ? Number(match[1]) : null;
}

function validPoint(lon: number, lat: number): boolean {
	return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

function parsePoint(text: string): GeographicPoint | undefined {
	const east = labelled(text, '东经|经度|longitude|lon');
	const west = labelled(text, '西经');
	const north = labelled(text, '北纬|纬度|latitude|lat');
	const south = labelled(text, '南纬');
	if ((east !== null || west !== null) && (north !== null || south !== null)) {
		const lon = west !== null ? -Math.abs(west) : east!;
		const lat = south !== null ? -Math.abs(south) : north!;
		return validPoint(lon, lat) ? [lon, lat] : undefined;
	}
	const pair = text.match(new RegExp(`[（(]?\\s*${COORDINATE}\\s*[,，、/]\\s*${COORDINATE}\\s*[)）]?`, 'i'));
	if (!pair) return undefined;
	let lon = Number(pair[1]);
	let lat = Number(pair[3]);
	if (/[W西]/i.test(pair[2] ?? '')) lon = -Math.abs(lon);
	if (/[S南]/i.test(pair[4] ?? '')) lat = -Math.abs(lat);
	return validPoint(lon, lat) ? [lon, lat] : undefined;
}

function afterLabel(text: string, label: RegExp): string | undefined {
	const match = label.exec(text);
	return match ? text.slice(match.index + match[0].length).split(/[；;\n]/, 1)[0].slice(0, 100) : undefined;
}

function parseRadiusKm(text: string): number | undefined {
	const match = text.match(new RegExp(`(?:半径|方圆|周围|周边|附近|向外)\\s*(?:约|大约)?\\s*${NUMBER}\\s*(公里|千米|km|米|m)(?:以内|范围内)?`, 'i'))
		?? text.match(new RegExp(`${NUMBER}\\s*(公里|千米|km|米|m)\\s*(?:的)?(?:半径|范围内|范围|周边|附近)`, 'i'));
	if (!match) return undefined;
	const radius = Number(match[1]) * (/^(?:米|m)$/i.test(match[2]) ? 0.001 : 1);
	return Number.isFinite(radius) ? radius : undefined;
}

/** 将中心点与半径换算为向外取整到四位小数的 WGS84 包围框。 */
export function inferRadiusBounds(center: GeographicPoint, radiusKm: number): ChatScanCoordinates {
	if (!Number.isFinite(radiusKm) || radiusKm <= 0) return { centerPoint: center, error: '扫描半径必须大于 0。' };
	const latitudeRadians = center[1] * Math.PI / 180;
	const latitudeOffset = radiusKm * 1000 / 6_371_000 * 180 / Math.PI;
	const longitudeOffset = latitudeOffset / Math.cos(latitudeRadians);
	if (!Number.isFinite(longitudeOffset) || center[1] - latitudeOffset <= -90 || center[1] + latitudeOffset >= 90
		|| center[0] - longitudeOffset <= -180 || center[0] + longitudeOffset >= 180) {
		return { centerPoint: center, radiusKm, error: '扫描范围跨越极点或 180° 经线，请手动填写东西南北边界。' };
	}
	const lower = (value: number) => Math.floor(value * 10_000 + 1e-8) / 10_000;
	const upper = (value: number) => Math.ceil(value * 10_000 - 1e-8) / 10_000;
	return {
		centerPoint: center,
		radiusKm,
		bounds: {
			west: lower(center[0] - longitudeOffset), east: upper(center[0] + longitudeOffset),
			south: lower(center[1] - latitudeOffset), north: upper(center[1] + latitudeOffset),
		},
		derivedBounds: true,
	};
}

export function inferScanBounds(start: GeographicPoint, end: GeographicPoint): ChatScanCoordinates {
	const midLat = (start[1] + end[1]) / 2;
	const latMargin = 0.006;
	const lonMargin = latMargin / Math.max(Math.cos(midLat * Math.PI / 180), 0.25);
	const lower = (value: number) => Math.floor(value * 10_000 + 1e-8) / 10_000;
	const upper = (value: number) => Math.ceil(value * 10_000 - 1e-8) / 10_000;
	const west = Math.max(-180, lower(Math.min(start[0], end[0]) - lonMargin));
	const east = Math.min(180, upper(Math.max(start[0], end[0]) + lonMargin));
	const south = Math.max(-90, lower(Math.min(start[1], end[1]) - latMargin));
	const north = Math.min(90, upper(Math.max(start[1], end[1]) + latMargin));
	if (east - west > 0.3 || north - south > 0.3) {
		return { startPoint: start, endPoint: end, error: '起终点相距较远，请补充扫描海域的东西南北边界，以免自动规划范围过大。' };
	}
	return { startPoint: start, endPoint: end, bounds: { west, east, south, north }, derivedBounds: true };
}

/** 解析扫描边界、起终点，以及中心点附近的扫描范围。 */
export function parseChatScanCoordinates(text: string): ChatScanCoordinates | null {
	const west = labelled(text, '西界|西侧经度|西边界');
	const east = labelled(text, '东界|东侧经度|东边界');
	const south = labelled(text, '南界|南侧纬度|南边界');
	const north = labelled(text, '北界|北侧纬度|北边界');
	let bounds = west !== null && east !== null && south !== null && north !== null && west < east && south < north
		&& validPoint(west, south) && validPoint(east, north) ? { west, east, south, north } : undefined;
	if (!bounds) {
		const ranges = text.match(new RegExp(`(?:经度|longitude)\\s*[:：]?\\s*${NUMBER}\\s*[~～—–-]\\s*${NUMBER}[\\s\\S]{0,35}?(?:纬度|latitude)\\s*[:：]?\\s*${NUMBER}\\s*[~～—–-]\\s*${NUMBER}`, 'i'));
		if (ranges) {
			const values = ranges.slice(1).map(Number);
			if (validPoint(values[0], values[2]) && validPoint(values[1], values[3]) && values[0] < values[1] && values[2] < values[3]) {
				bounds = { west: values[0], east: values[1], south: values[2], north: values[3] };
			}
		}
	}
	const startText = afterLabel(text, /(?:起点|从|由)\s*[:：]?/);
	const endText = afterLabel(text, /(?:终点|目的地|到达|到|至)\s*[:：]?/);
	const startPoint = startText ? parsePoint(startText) : undefined;
	const endPoint = endText ? parsePoint(endText) : undefined;
	if (startPoint && endPoint && !bounds) return inferScanBounds(startPoint, endPoint);
	if (!bounds && !startPoint && !endPoint && /扫描|扫测|巡检|巡航|航线|海域规划|海域搜索/.test(text)) {
		const center = parsePoint(text);
		if (center) return inferRadiusBounds(center, parseRadiusKm(text) ?? 5);
	}
	return bounds || startPoint || endPoint ? { ...(bounds ? { bounds } : {}), ...(startPoint ? { startPoint } : {}), ...(endPoint ? { endPoint } : {}) } : null;
}
