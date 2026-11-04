export const SATELLITE_ATTRIBUTION = 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)';

// 图片导出和发给模型的地图快照保留影像服务要求的完整署名。
export function drawSatelliteAttribution(context: CanvasRenderingContext2D, width: number, height: number) {
	context.save();
	const fontSize = Math.max(11, Math.min(15, width / 90));
	context.font = `${fontSize}px Arial, sans-serif`;
	const padding = 8;
	const textWidth = context.measureText(SATELLITE_ATTRIBUTION).width;
	const boxWidth = Math.min(width - 12, textWidth + padding * 2);
	const x = width - boxWidth - 6;
	const y = height - fontSize - padding * 2 - 6;
	context.fillStyle = 'rgba(2, 20, 34, 0.84)';
	context.fillRect(x, y, boxWidth, fontSize + padding * 2);
	context.fillStyle = '#edfaff';
	context.textBaseline = 'middle';
	context.fillText(SATELLITE_ATTRIBUTION, x + padding, y + (fontSize + padding * 2) / 2, boxWidth - padding * 2);
	context.restore();
}
