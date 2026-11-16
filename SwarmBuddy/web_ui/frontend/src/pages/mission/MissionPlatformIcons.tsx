import type { SVGProps } from 'react';

// 地图、雷达和图例共用俯视图标，缩小时仍保留载具轮廓。
export function UavIcon(props: SVGProps<SVGSVGElement>) {
	return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
		<g stroke="#07507a" strokeLinecap="round" strokeLinejoin="round">
			<path d="M19 20 8 10m21 10 11-10M19 28 8 38m21-10 11 10" stroke="#eafaff" strokeWidth="5" />
			<circle cx="8" cy="10" r="5" fill="#a5edff" strokeWidth="2" />
			<circle cx="40" cy="10" r="5" fill="#a5edff" strokeWidth="2" />
			<circle cx="8" cy="38" r="5" fill="#a5edff" strokeWidth="2" />
			<circle cx="40" cy="38" r="5" fill="#a5edff" strokeWidth="2" />
			<path d="M24 15c5 0 8 4 8 9s-3 9-8 9-8-4-8-9 3-9 8-9Z" fill="#f7fdff" strokeWidth="2.4" />
			<path d="M24 18v12" stroke="#4abce9" strokeWidth="2" />
		</g>
	</svg>;
}

export function UsvIcon(props: SVGProps<SVGSVGElement>) {
	return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
		<g transform="rotate(19 24 25)" strokeLinecap="round" strokeLinejoin="round">
			<path d="M3 21c5-6 15-9 27-7 7 1 13 5 16 10-4 6-11 10-21 10C15 33 7 29 3 21Z" fill="#dff9ff" stroke="#47caff" strokeWidth="4" />
			<path d="M4 20c6-5 15-7 26-5 7 1 12 4 16 9-6 5-14 8-23 7C14 30 7 26 4 20Z" fill="#f7fdff" stroke="#075384" strokeWidth="2" />
			<path d="M10 20c9-3 20-2 28 3-8 4-18 4-27 1Z" fill="#177fb5" stroke="#8be2ff" strokeWidth="1.4" />
			<path d="M19 20c2-3 7-4 12-2l4 5c-4 2-10 2-15 0Z" fill="#fff" stroke="#0c6599" strokeWidth="1.5" />
			<path d="M25 18V5m0 0 4 2" stroke="#f7fdff" strokeWidth="2.7" />
			<path d="M16 28c8 4 18 4 25-1" stroke="#7cdbff" strokeWidth="1.7" />
		</g>
	</svg>;
}
