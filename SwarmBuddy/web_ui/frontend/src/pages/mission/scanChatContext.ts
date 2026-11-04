import type { ContentBlock } from '@agentscope-ai/agentscope/message';

import { drawSatelliteAttribution } from './satelliteAttribution';
import type { ScanResult } from '@/api/missionScan';

type TextBlock = Extract<ContentBlock, { type: 'text' }>;
type DataBlock = Extract<ContentBlock, { type: 'data' }>;

const SCAN_CONTEXT_MARKER = '[SwarmBuddy 当前海域扫描结果]';
const SCAN_CONTEXT_IMAGE_NAME = 'SwarmBuddy 当前海域扫描图.png';

export function isScanContextBlock(block: ContentBlock): boolean {
	return block.type === 'text' && block.text.startsWith(SCAN_CONTEXT_MARKER)
		|| block.type === 'data' && block.name === SCAN_CONTEXT_IMAGE_NAME;
}

function scanSummary(result: ScanResult): string {
	const bounds = result.bounds;
	const point = (value: [number, number] | null | undefined) => value
		? `${Math.abs(value[0]).toFixed(4)}°${value[0] < 0 ? 'W' : 'E'}、${Math.abs(value[1]).toFixed(4)}°${value[1] < 0 ? 'S' : 'N'}` : '未指定';
	return [
		'以下是当前会话右侧显示的海域扫描结果。请结合用户问题回答；数值以此结果为准，不要把规划值当成实际航行记录。',
		`资料类型：${result.source}；规划校验：${result.validated ? '通过' : '未通过'}。`,
		`范围：西 ${bounds.west.toFixed(4)}°、东 ${bounds.east.toFixed(4)}°、南 ${bounds.south.toFixed(4)}°、北 ${bounds.north.toFixed(4)}°。`,
		`起点：${point(result.start_point)}；终点：${point(result.end_point)}。`,
		`扫描间距 ${result.spacing_m} 米；避障距离 ${result.obstacle_buffer_m} 米；障碍物 ${result.obstacle_count} 处；禁入区 ${result.no_go_zone_count ?? 0} 处。`,
		`规划航程 ${(result.path_length_m / 1000).toFixed(2)} 公里；航点 ${result.waypoint_count} 个；预计覆盖率 ${result.planned_coverage_percent.toFixed(1)}%；目标面积 ${(result.target_area_m2 / 1_000_000).toFixed(2)} 平方公里；预计耗时 ${result.estimated_duration_hours?.toFixed(2) ?? '未知'} 小时。`,
		result.source === 'bounds_only' ? '该航线仅按经纬度边界生成，没有障碍物、禁航区或海况资料。' : '',
		'若问题涉及地图形状、岛礁位置或局部走线，优先结合随附地图快照；没有快照时只依据已知数据回答，并说明无法直接判断图像细节。需要精确航点时调用 ReadOceanScanResult(include_geometry=true)。',
	].filter(Boolean).join('\n');
}

/** 截取右侧当前显示的 SVG 地图，并保留缩放状态。 */
async function captureMap(svg: SVGSVGElement): Promise<string> {
	const clone = svg.cloneNode(true) as SVGSVGElement;
	clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	clone.setAttribute('width', '1000');
	clone.setAttribute('height', '625');
	const sourceElements = [svg, ...Array.from(svg.querySelectorAll('*'))];
	const clonedElements = [clone, ...Array.from(clone.querySelectorAll('*'))];
	const window = svg.ownerDocument.defaultView;
	if (!window) throw new Error('地图窗口不可用');
	const visualProperties = ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'fill-opacity', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'color', 'opacity'];
	sourceElements.forEach((element, index) => {
		const computed = window.getComputedStyle(element);
		const target = clonedElements[index] as SVGElement;
		for (const property of visualProperties) target.style.setProperty(property, computed.getPropertyValue(property));
	});
	// 移除运动效果，确保每次导出的地图快照一致。
	clone.querySelectorAll('animateMotion').forEach((node) => node.remove());
	const boat = clone.querySelector('.mission-route-boat');
	if (boat && !boat.getAttribute('transform')) boat.remove();
	const xml = new XMLSerializer().serializeToString(clone);
	const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
	try {
		const image = new Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('地图快照生成失败'));
			image.src = url;
		});
		const canvas = svg.ownerDocument.createElement('canvas');
		canvas.width = 1000;
		canvas.height = 625;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('地图画布不可用');
		context.drawImage(image, 0, 0, 1000, 625);
		if (svg.querySelector('image[href^="data:image/"]')) drawSatelliteAttribution(context, 1000, 625);
		return canvas.toDataURL('image/png').split(',')[1];
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function createScanChatContextBlocks(result: ScanResult, mapFrame: HTMLElement | null, supportsImage: boolean): Promise<(TextBlock | DataBlock)[]> {
	const now = new Date().toISOString();
	const text: TextBlock = { id: crypto.randomUUID(), type: 'text', text: `${SCAN_CONTEXT_MARKER}\n${scanSummary(result)}`, created_at: now };
	const blocks: (TextBlock | DataBlock)[] = [text];
	const svg = supportsImage ? mapFrame?.querySelector<SVGSVGElement>('svg.mission-real-scan-map') : null;
	if (svg) {
		try {
			const data = await captureMap(svg);
			blocks.push({
				id: crypto.randomUUID(), type: 'data', name: SCAN_CONTEXT_IMAGE_NAME,
				source: { type: 'base64', media_type: 'image/png', data }, created_at: now,
			});
		} catch {
			// 浏览器无法将 SVG 转为位图时，仍可使用结构化扫描结果。
		}
	}
	return blocks;
}
