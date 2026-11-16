import { useEffect, useRef } from 'react';
import type { MouseEvent, WheelEvent } from 'react';

import { radarContactPosition } from './missionRadarGeometry';
import type { SimulationAsset, SimulationPoint } from './missionCooperationSimulation';

type RadarProps = {
	origin: SimulationAsset | undefined;
	contacts: SimulationAsset[];
	target: SimulationPoint | null;
	targetSelected: boolean;
	metersPerUnit: number;
	rangeMeters: number;
	running: boolean;
	onSelectUsv: (id: string) => void;
	onSelectTarget: () => void;
	onZoom: (direction: 'in' | 'out') => void;
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function MissionRadarCanvas(props: RadarProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const propsRef = useRef(props);
	propsRef.current = props;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let frame = 0;
		let timer = 0;
		let angle = -Math.PI / 2;
		let lastTime = 0;
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const draw = (time: number) => {
			const current = propsRef.current;
			const size = Math.max(1, canvas.clientWidth);
			const ratio = window.devicePixelRatio || 1;
			const pixels = Math.round(size * ratio);
			if (canvas.width !== pixels || canvas.height !== pixels) { canvas.width = pixels; canvas.height = pixels; }
			const context = canvas.getContext('2d');
			if (!context) return;
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			context.clearRect(0, 0, size, size);
			const center = size / 2;
			const radius = size * .46;
			const background = context.createRadialGradient(center, center, 0, center, center, radius);
			background.addColorStop(0, '#0b4968');
			background.addColorStop(.42, '#082e4a');
			background.addColorStop(1, '#031626');
			context.fillStyle = background;
			context.beginPath(); context.arc(center, center, radius, 0, Math.PI * 2); context.fill();
			context.save();
			context.beginPath(); context.arc(center, center, radius, 0, Math.PI * 2); context.clip();
			if (current.running && !reducedMotion && lastTime) angle += Math.min(time - lastTime, 80) * .0011;
			lastTime = time;
			for (let index = 0; index < 22; index++) {
				const from = angle - 1.15 + index * .052;
				const sweep = context.createRadialGradient(center, center, 0, center, center, radius);
				sweep.addColorStop(0, `rgba(66,205,255,${.018 + index * .005})`);
				sweep.addColorStop(1, `rgba(24,139,227,${.008 + index * .003})`);
				context.fillStyle = sweep;
				context.beginPath(); context.moveTo(center, center);
				context.arc(center, center, radius, from, from + .054); context.closePath(); context.fill();
			}
			context.shadowColor = '#53d7ff'; context.shadowBlur = 10;
			context.strokeStyle = 'rgba(132,231,255,.8)'; context.lineWidth = 1.35;
			context.beginPath(); context.moveTo(center, center);
			context.lineTo(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius); context.stroke();
			context.shadowBlur = 0;
			context.strokeStyle = 'rgba(64,172,218,.24)'; context.lineWidth = 1;
			for (let bearing = 0; bearing < 360; bearing += 30) {
				const radians = bearing * Math.PI / 180;
				context.beginPath(); context.moveTo(center, center);
				context.lineTo(center + Math.sin(radians) * radius, center - Math.cos(radians) * radius); context.stroke();
			}
			context.strokeStyle = 'rgba(76,205,243,.42)';
			for (const fraction of [.2, .4, .6, .8, 1]) {
				context.beginPath(); context.arc(center, center, radius * fraction, 0, Math.PI * 2); context.stroke();
			}
			context.strokeStyle = 'rgba(118,220,248,.7)';
			for (let bearing = 0; bearing < 360; bearing += 5) {
				const radians = bearing * Math.PI / 180;
				const inner = radius * (bearing % 30 === 0 ? .91 : .965);
				context.beginPath();
				context.moveTo(center + Math.sin(radians) * inner, center - Math.cos(radians) * inner);
				context.lineTo(center + Math.sin(radians) * radius, center - Math.cos(radians) * radius);
				context.stroke();
			}
			context.strokeStyle = 'rgba(145,242,255,.48)'; context.lineWidth = 1;
			context.beginPath(); context.moveTo(center - radius, center); context.lineTo(center + radius, center);
			context.moveTo(center, center - radius); context.lineTo(center, center + radius); context.stroke();
			context.fillStyle = 'rgba(195,240,255,.82)'; context.font = `${Math.max(8, size * .055)}px sans-serif`;
			context.fillText('N', center - 3, center - radius + 11);
			context.fillText('E', center + radius - 11, center + 3);
			context.fillStyle = 'rgba(125,203,225,.6)'; context.font = `${Math.max(7, size * .045)}px sans-serif`;
			context.fillText(`${current.rangeMeters < 1000 ? Math.round(current.rangeMeters / 2) + 'm' : (current.rangeMeters / 2000).toFixed(1) + 'km'}`, center + 3, center - radius * .5 - 3);
			if (current.origin) {
				for (const contact of current.contacts) {
					const plot = radarContactPosition(current.origin.position, contact.position, current.metersPerUnit, current.rangeMeters, radius, center);
					if (!plot.visible || contact.id === current.origin.id) continue;
					context.fillStyle = contact.kind === 'usv' ? '#55e3c0' : '#86d9ff';
					context.shadowColor = context.fillStyle; context.shadowBlur = 12;
					context.beginPath(); context.arc(plot.x, plot.y, contact.kind === 'usv' ? 4 : 3, 0, Math.PI * 2); context.fill();
					context.shadowBlur = 0;
				}
				if (current.target) {
					const plot = radarContactPosition(current.origin.position, current.target, current.metersPerUnit, current.rangeMeters, radius, center);
					if (plot.visible) {
						context.strokeStyle = current.targetSelected ? '#fff4a0' : '#ffb36b';
						context.lineWidth = current.targetSelected ? 2.5 : 1.5;
						context.shadowColor = '#ffc46e'; context.shadowBlur = 14;
						context.beginPath(); context.moveTo(plot.x, plot.y - 6); context.lineTo(plot.x + 6, plot.y);
						context.lineTo(plot.x, plot.y + 6); context.lineTo(plot.x - 6, plot.y); context.closePath(); context.stroke();
						context.shadowBlur = 0;
						if (current.targetSelected) { context.beginPath(); context.arc(plot.x, plot.y, 10, 0, Math.PI * 2); context.stroke(); }
					}
				}
			}
			context.restore();
			context.strokeStyle = 'rgba(22,127,181,.44)'; context.lineWidth = 1;
			context.beginPath(); context.arc(center, center, radius + 4, 0, Math.PI * 2); context.stroke();
			context.shadowColor = '#37dbff'; context.shadowBlur = 13;
			context.strokeStyle = '#39c6f2'; context.lineWidth = 2;
			context.beginPath(); context.arc(center, center, radius, 0, Math.PI * 2); context.stroke();
			context.shadowBlur = 0;
			context.strokeStyle = '#b0f6ff'; context.lineWidth = 2;
			context.beginPath(); context.moveTo(center - 6, center); context.lineTo(center + 6, center);
			context.moveTo(center, center - 6); context.lineTo(center, center + 6); context.stroke();
			context.fillStyle = '#b0f6ff'; context.beginPath(); context.arc(center, center, 2.5, 0, Math.PI * 2); context.fill();
			if (current.running && !reducedMotion) frame = window.requestAnimationFrame(draw);
			else timer = window.setTimeout(() => { frame = window.requestAnimationFrame(draw); }, 120);
		};
		frame = window.requestAnimationFrame(draw);
		return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
	}, []);

	const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		const { origin, target, contacts, metersPerUnit, rangeMeters } = propsRef.current;
		if (!canvas || !origin) return;
		const rectangle = canvas.getBoundingClientRect();
		const size = rectangle.width;
		const center = size / 2;
		const radius = size * .46;
		const x = clamp(event.clientX - rectangle.left, 0, size);
		const y = clamp(event.clientY - rectangle.top, 0, size);
		if (target) {
			const plot = radarContactPosition(origin.position, target, metersPerUnit, rangeMeters, radius, center);
			if (plot.visible && Math.hypot(x - plot.x, y - plot.y) <= 13) { propsRef.current.onSelectTarget(); return; }
		}
		for (const contact of contacts) {
			if (contact.kind !== 'usv' || contact.id === origin.id) continue;
			const plot = radarContactPosition(origin.position, contact.position, metersPerUnit, rangeMeters, radius, center);
			if (plot.visible && Math.hypot(x - plot.x, y - plot.y) <= 10) { propsRef.current.onSelectUsv(contact.id); return; }
		}
	};
	return <canvas ref={canvasRef} className="mission-radar-canvas" role="img" aria-label={`仿真雷达，以 ${props.origin?.id ?? '无人艇'} 为中心；点击目标可定位地图，滚轮可缩放量程`} onClick={handleClick} onWheel={(event: WheelEvent<HTMLCanvasElement>) => { event.preventDefault(); propsRef.current.onZoom(event.deltaY < 0 ? 'in' : 'out'); }} />;
}
