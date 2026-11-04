import { ChevronDown, Download, FileJson, Image as ImageIcon, Save, ScanLine, Target } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';

import { simulatedCoverage, simulationAssets } from './missionCooperationSimulation';
import type { CooperationSimulation } from './missionCooperationSimulation';
import { drawSatelliteAttribution } from './satelliteAttribution';
import { missionScanApi } from '@/api/missionScan';
import type { ScanResult } from '@/api/missionScan';

function downloadBlob(document: Document, blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function area(value: number | undefined) {
	return typeof value === 'number' && Number.isFinite(value) ? `${(value / 1_000_000).toFixed(2)} km²` : '待计算';
}

function duration(result: ScanResult | null, speedKnots: number) {
	if (!result || !Number.isFinite(result.path_length_m) || !Number.isFinite(speedKnots) || speedKnots <= 0) return '待计算';
	const minutes = Math.round(result.path_length_m / (speedKnots * 1852) * 60);
	return `${Math.floor(minutes / 60)} 小时 ${String(minutes % 60).padStart(2, '0')} 分`;
}

export function MissionScanDownloadSave({ result, speedKnots, agentId, sessionId, mapFrameRef }: {
	result: ScanResult | null;
	speedKnots: number;
	agentId?: string;
	sessionId?: string;
	mapFrameRef: RefObject<HTMLDivElement | null>;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [notice, setNotice] = useState('');
	const menuRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!menuOpen) return;
		const doc = menuRef.current?.ownerDocument;
		const close = (event: PointerEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
		};
		doc?.addEventListener('pointerdown', close);
		return () => doc?.removeEventListener('pointerdown', close);
	}, [menuOpen]);

	const exportImage = async () => {
		const svg = mapFrameRef.current?.querySelector<SVGSVGElement>('.mission-real-scan-map');
		if (!svg) return;
		const doc = svg.ownerDocument;
		const clone = svg.cloneNode(true) as SVGSVGElement;
		clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
		const size = svg.getBoundingClientRect();
		const width = Math.max(1, Math.round(size.width * 2));
		const height = Math.max(1, Math.round(size.height * 2));
		clone.setAttribute('width', String(width));
		clone.setAttribute('height', String(height));
		const originalNodes = [svg, ...svg.querySelectorAll('*')];
		const clonedNodes = [clone, ...clone.querySelectorAll('*')];
		originalNodes.forEach((node, index) => {
			const source = doc.defaultView?.getComputedStyle(node);
			const target = clonedNodes[index] as Element | undefined;
			if (!source || !target) return;
			for (const property of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linejoin', 'stroke-linecap', 'font-family', 'font-size', 'font-weight', 'paint-order', 'opacity']) {
				const value = source.getPropertyValue(property);
				if (value) (target as SVGElement).style.setProperty(property, value);
			}
		});
		try {
			const source = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
			const url = URL.createObjectURL(source);
			const image = new Image();
			image.src = url;
			await image.decode();
			const canvas = doc.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext('2d');
			context?.drawImage(image, 0, 0, width, height);
			if (context && svg.querySelector('image[href^="data:image/"]')) drawSatelliteAttribution(context, width, height);
			URL.revokeObjectURL(url);
			const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
			if (!png) throw new Error('图片生成失败');
			downloadBlob(doc, png, `海域扫描航迹-${sessionId ?? 'plan'}.png`);
			setNotice('图片已下载');
		} catch (error) {
			setNotice(error instanceof Error ? error.message : '图片下载失败');
		}
		setMenuOpen(false);
	};

	const exportData = () => {
		if (!result) return;
		const featureCollection = {
			type: 'FeatureCollection',
			bbox: [result.bounds.west, result.bounds.south, result.bounds.east, result.bounds.north],
			metadata: {
				spacing_m: result.spacing_m,
				obstacle_buffer_m: result.obstacle_buffer_m,
				speed_knots: speedKnots,
				estimated_duration_hours: result.path_length_m / (speedKnots * 1852),
				path_length_m: result.path_length_m,
				waypoint_count: result.waypoint_count,
				planned_coverage_percent: result.planned_coverage_percent,
				covered_area_m2: result.covered_area_m2,
				target_area_m2: result.target_area_m2,
				uncovered_area_m2: Number.isFinite(result.target_area_m2) && Number.isFinite(result.covered_area_m2) ? Math.max(0, result.target_area_m2 - result.covered_area_m2) : null,
			},
			features: [{ type: 'Feature', properties: { name: '规划航迹' }, geometry: result.route_geojson }],
		};
		downloadBlob(menuRef.current!.ownerDocument, new Blob([JSON.stringify(featureCollection, null, 2)], { type: 'application/geo+json' }), `海域扫描规划-${sessionId ?? 'plan'}.geojson`);
		setNotice('规划数据已导出');
		setMenuOpen(false);
	};

	const savePlan = async () => {
		if (!agentId || !sessionId) return;
		setSaving(true);
		try {
			await missionScanApi.updateSpeed(agentId, sessionId, speedKnots);
			await missionScanApi.savePlan(agentId, sessionId);
			setNotice('方案已保存到项目');
		} catch (error) {
			setNotice(error instanceof Error ? `保存失败：${error.message}` : '保存失败');
		} finally {
			setSaving(false);
			setMenuOpen(false);
		}
	};

	return <>
		<div className="mission-scan-save" ref={menuRef}>
			<button type="button" className="mission-scan-save-trigger" disabled={!result} aria-expanded={menuOpen} onClick={() => { setNotice(''); setMenuOpen((open) => !open); }}>
				<Download size={16} /> 下载保存 <ChevronDown size={15} />
			</button>
			{menuOpen && <div className="mission-scan-save-menu" role="menu">
				<button type="button" role="menuitem" onClick={() => void exportImage()}><ImageIcon size={15} /> 下载图片（PNG）</button>
				<button type="button" role="menuitem" onClick={exportData}><FileJson size={15} /> 导出规划数据（GeoJSON）</button>
				<button type="button" role="menuitem" disabled={saving || !agentId || !sessionId} onClick={() => void savePlan()}><Save size={15} /> {saving ? '保存中…' : '保存方案'}</button>
			</div>}
		</div>
		{notice && <span className="mission-scan-save-notice" role="status">{notice}</span>}
	</>;
}

export function MissionScanSummary({ result, speedKnots, portalDocument, cooperation }: { result: ScanResult | null; speedKnots: number; portalDocument?: Document | null; cooperation: CooperationSimulation }) {
	const [detailsOpen, setDetailsOpen] = useState(false);
	const uncovered = result && Number.isFinite(result.target_area_m2) && Number.isFinite(result.covered_area_m2)
		? Math.max(0, result.target_area_m2 - result.covered_area_m2) : undefined;
	const coverage = result && Number.isFinite(result.planned_coverage_percent) ? Math.max(0, Math.min(100, result.planned_coverage_percent)) : 0;
	const assets = result ? simulationAssets(result, cooperation) : [];
	const simStarted = cooperation.second > 0 || cooperation.running;
	const runningCount = assets.filter((asset) => asset.status === '搜索中' || asset.status === '转场中' || asset.status === '复核中').length;
	const offlineCount = assets.filter((asset) => asset.status === '失联').length;
	return <div className="mission-scan-summary situation-summary">
		<article className="situation-stat-card">
			<header><h3>任务效率</h3><button className="situation-stat-detail-button" type="button" onClick={() => setDetailsOpen(true)}>查看详情 ›</button></header>
			<div className="situation-efficiency-body"><div className="situation-gauge" style={{ '--gauge-value': `${coverage}%` } as React.CSSProperties}><strong>{result ? `${coverage.toFixed(0)}%` : '—'}</strong><small>规划覆盖率</small></div><div className="situation-efficiency-numbers"><div><strong>{area(result?.covered_area_m2)}</strong><span>预计覆盖面积</span></div><div><strong>{area(result?.target_area_m2)}</strong><span>任务海域面积</span></div></div></div>
		</article>
		<article className="situation-stat-card">
			<header><h3>训练目标</h3><span className="situation-stat-muted">仿真</span></header>
			<div className="situation-target-stats"><div><i className="red"><Target size={16} /></i><strong>{simStarted ? Number(cooperation.targetStatus === 'suspected') : '—'}</strong><span>疑似目标</span></div><div><i className="gold"><Target size={16} /></i><strong>{simStarted ? Number(cooperation.targetStatus === 'confirmed') : '—'}</strong><span>已复核</span></div><div><i className="cyan"><ScanLine size={16} /></i><strong>{simStarted ? Number(cooperation.targetStatus === 'suspected') : '—'}</strong><span>待复核</span></div></div>
		</article>
		<article className="situation-stat-card">
			<header><h3>平台状态</h3><span className="situation-stat-muted">仿真</span></header>
			<div className="situation-agent-body"><div className="situation-agent-ring"><strong>{result ? '2' : '—'}</strong><small>总数</small></div><div className="situation-agent-legend"><span><i className="running" />运行中 <b>{simStarted ? runningCount : '—'}</b></span><span><i className="standby" />待命 <b>{simStarted ? assets.filter((asset) => asset.status === '待命').length : '—'}</b></span><span><i className="offline" />离线 <b>{simStarted ? offlineCount : '—'}</b></span></div></div>
		</article>
		<article className="situation-stat-card">
			<header><h3>任务耗时</h3><span className="situation-stat-muted">{simStarted ? '加速仿真' : '规划估算'}</span></header>
			<div className="situation-duration-value">{simStarted ? `${String(Math.floor(cooperation.second / 60)).padStart(2, '0')}:${String(cooperation.second % 60).padStart(2, '0')}` : duration(result, speedKnots)}</div><span className="situation-duration-caption">{simStarted ? '仿真时间不代表真实航行时间' : `按 ${speedKnots} 节恒定航速估算`}</span><div className="situation-duration-track"><i style={{ width: `${simStarted ? simulatedCoverage(cooperation) : result ? 100 : 0}%` }} /></div><div className="situation-duration-foot"><span>{simStarted ? '航迹执行' : '规划航程'}</span><strong>{simStarted ? `${simulatedCoverage(cooperation)}%` : result ? `${(result.path_length_m / 1000).toFixed(1)} km` : '待计算'}</strong></div>
		</article>
	{detailsOpen && portalDocument && createPortal(<div className="situation-detail-backdrop" role="presentation" onMouseDown={() => setDetailsOpen(false)}><section className="situation-detail-dialog" role="dialog" aria-modal="true" aria-label="扫描规划详情" onMouseDown={(event) => event.stopPropagation()}><header><h3>扫描规划详情</h3><button type="button" aria-label="关闭详情" onClick={() => setDetailsOpen(false)}>×</button></header><dl><div><dt>规划覆盖率</dt><dd>{result ? `${coverage.toFixed(1)}%` : '待计算'}</dd></div><div><dt>规划航程</dt><dd>{result ? `${(result.path_length_m / 1000).toFixed(1)} km` : '待计算'}</dd></div><div><dt>预计覆盖面积</dt><dd>{area(result?.covered_area_m2)}</dd></div><div><dt>目标面积</dt><dd>{area(result?.target_area_m2)}</dd></div><div><dt>未覆盖面积</dt><dd>{area(uncovered)}</dd></div><div><dt>航点数量</dt><dd>{result?.waypoint_count ?? '待计算'}</dd></div><div><dt>预计耗时</dt><dd>{duration(result, speedKnots)}</dd></div></dl></section></div>, portalDocument.body)}
	</div>;
}
