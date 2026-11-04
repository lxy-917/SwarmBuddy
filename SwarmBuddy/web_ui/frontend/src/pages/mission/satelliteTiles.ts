import { getBaseUrl } from '@/api/client';

export type SatelliteTile = { key: string; z: number; x: number; y: number; west: number; east: number; north: number; south: number };

const MAX_ZOOM = 14;
const TILE_SIZE = 256;
const tileImages = new Map<string, Promise<string>>();

function latitudeToY(latitude: number, zoom: number) {
	const radians = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180;
	return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom;
}

function yToLatitude(y: number, zoom: number) {
	return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** zoom))) * 180 / Math.PI;
}

export function visibleSatelliteTiles(bounds: { west: number; east: number; south: number; north: number }, widthPixels: number): SatelliteTile[] {
	const span = bounds.east - bounds.west;
	if (!(span > 0) || !(bounds.north > bounds.south) || !(widthPixels > 0)) return [];
	let zoom = Math.max(0, Math.min(MAX_ZOOM, Math.round(Math.log2(360 * widthPixels / (span * TILE_SIZE)))));
	const rangeForZoom = (level: number) => {
		const count = 2 ** level;
		return {
			count,
			westX: Math.max(0, Math.min(count - 1, Math.floor((bounds.west + 180) / 360 * count))),
			eastX: Math.max(0, Math.min(count - 1, Math.floor((bounds.east + 180) / 360 * count))),
			northY: Math.max(0, Math.min(count - 1, Math.floor(latitudeToY(bounds.north, level)))),
			southY: Math.max(0, Math.min(count - 1, Math.floor(latitudeToY(bounds.south, level)))),
		};
	};
	let selected = rangeForZoom(zoom);
	// 降低极端长条区域的瓦片级别，确保整幅底图都有影像，而不是只显示前 100 片。
	while (zoom > 0 && (selected.eastX - selected.westX + 1) * (selected.southY - selected.northY + 1) > 64) {
		zoom -= 1;
		selected = rangeForZoom(zoom);
	}
	const { count, westX, eastX, northY, southY } = selected;
	if (westX > eastX || northY > southY) return [];
	const tiles: SatelliteTile[] = [];
	for (let y = northY; y <= southY; y += 1) {
		for (let x = westX; x <= eastX; x += 1) {
			tiles.push({
				key: `${zoom}/${x}/${y}`, z: zoom, x, y,
				west: x / count * 360 - 180,
				east: (x + 1) / count * 360 - 180,
				north: yToLatitude(y, zoom),
				south: yToLatitude(y + 1, zoom),
			});
		}
	}
	return tiles;
}

export function loadSatelliteTile(tile: SatelliteTile): Promise<string> {
	const existing = tileImages.get(tile.key);
	if (existing) return existing;
	const promise = (async () => {
		// 优先从服务端读取，以便导出时将同一瓦片嵌入 SVG；服务端不可达时再尝试公开 WMTS。
		const localUrl = new URL(`/mission/satellite/${tile.z}/${tile.x}/${tile.y}`, getBaseUrl() || window.location.origin);
		const publicUrl = `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/${tile.z}/${tile.y}/${tile.x}.jpg`;
		const localResponse = await fetch(localUrl).catch(() => null);
		const response = localResponse?.ok ? localResponse : await fetch(publicUrl);
		if (!response.ok) throw new Error(`卫星影像请求失败：${response.status}`);
		const blob = await response.blob();
		if (!blob.type.startsWith('image/')) throw new Error('卫星影像格式无效');
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(new Error('读取卫星影像失败'));
			reader.readAsDataURL(blob);
		});
	})();
	tileImages.set(tile.key, promise);
	promise.catch(() => tileImages.delete(tile.key));
	return promise;
}
