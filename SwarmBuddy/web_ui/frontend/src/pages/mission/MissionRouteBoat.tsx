import { memo, useEffect, useRef, useState } from 'react';

function useReducedMotion() {
	const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
	useEffect(() => {
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => setReduced(media.matches);
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	}, []);
	return reduced;
}

/** 让无人艇图标沿航线的 SVG 路径循环行驶；隔离聊天更新以保持动画流畅。 */
export const MissionRouteBoat = memo(function MissionRouteBoat({ path, scale = 0.9, duration = 38, paused = false }: { path: string; scale?: number; duration?: number; paused?: boolean }) {
	const reducedMotion = useReducedMotion();
	const boatRef = useRef<SVGGElement>(null);
	useEffect(() => {
		const svg = boatRef.current?.ownerSVGElement;
		if (!svg || !paused || reducedMotion) return;
		// 暂停 SVG 时间轴会保留当前航线位置，恢复后继续完成本圈及末尾的五秒等待。
		svg.pauseAnimations();
		return () => svg.unpauseAnimations();
	}, [paused, reducedMotion, path]);
	if (!path) return null;
	const start = path.match(/^M\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/i);
	return <g ref={boatRef} className="vehicle-marker mission-route-boat" aria-hidden="true" pointerEvents="none" transform={reducedMotion && start ? `translate(${start[1]} ${start[2]})` : undefined}>
		{!reducedMotion && <animateMotion key={path} path={path} dur={`${duration + 5}s`} keyPoints="0;1;1" keyTimes={`0;${duration / (duration + 5)};1`} calcMode="linear" repeatCount="indefinite" rotate="auto" />}
		<g transform={`scale(${scale})`}>
			<path d="M-28 -10 Q-34 -5 -28 0 Q-34 5 -28 10 M-35 -7 Q-39 0 -35 7" fill="none" stroke="#8de6e0" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
			<path d="M-24 -11 Q-4 -15 13 -10 L27 0 L13 10 Q-4 15 -24 11 Q-28 0 -24 -11Z" fill="#f3c995" stroke="#132a34" strokeWidth="2.2" />
			<path d="M-17 -7 Q-4 -10 12 -7 L21 0 L12 7 Q-4 10 -17 7Z" fill="#143d4a" stroke="#fff1ce" strokeWidth="1.2" />
			<path d="M-7 -6 Q1 -8 8 -5 L12 0 L8 5 Q1 8 -7 6Z" fill="#77cbd1" stroke="#d8f5e9" strokeWidth="1.2" />
			<circle cx="-12" cy="0" r="2.4" fill="#f5d29f" />
			<circle cx="18" cy="0" r="2" fill="#fff3c6" />
		</g>
	</g>;
});
