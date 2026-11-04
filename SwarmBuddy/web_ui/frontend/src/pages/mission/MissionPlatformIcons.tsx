import type { SVGProps } from 'react';

// 态势图中的载具使用统一的俯视剪影，缩小到图例尺寸仍能区分机翼和船体。
export function UavIcon(props: SVGProps<SVGSVGElement>) {
	return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
		<path d="M16 2.5c1.7 0 2.7 1.6 2.7 3.1v7.1l9.5 5.1c1.1.6 1.7 1.5 1.7 2.6v2.1l-11.2-3.2v6.1l3.5 2.5v1.7L16 28.2l-6.2 1.4v-1.7l3.5-2.5v-6.1L2.1 22.5v-2.1c0-1.1.6-2 1.7-2.6l9.5-5.1V5.6c0-1.5 1-3.1 2.7-3.1Z" fill="currentColor" />
		<path d="M16 5.5v20M6 19.6l8.1-4.1m11.9 4.1-8.1-4.1" stroke="#d9f9ff" strokeOpacity=".65" strokeWidth=".8" />
	</svg>;
}

export function UsvIcon(props: SVGProps<SVGSVGElement>) {
	return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
		<path d="M3 21.5h26l-3.8 5.3a3 3 0 0 1-2.4 1.2H9.2a3 3 0 0 1-2.4-1.2L3 21.5Z" fill="currentColor" />
		<path d="M9 20.8v-6.3h14v6.3M13 14.5V9h8v5.5M17 9V5.5m0 0 3.4 1.8M4 20.7h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
		<path d="M7.8 24.2h16.4" stroke="#d9f9ff" strokeOpacity=".75" strokeWidth="1.2" strokeLinecap="round" />
		<path d="M3 30c1.1-.8 2.2-.8 3.3 0 1.1.8 2.2.8 3.3 0s2.2-.8 3.3 0c1.1.8 2.2.8 3.3 0s2.2-.8 3.3 0c1.1.8 2.2.8 3.3 0s2.2-.8 3.3 0c1.1.8 2.2.8 3.3 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
	</svg>;
}
