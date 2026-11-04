export function parseMissionTime(value?: string | null): number | null {
	if (!value) return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : null;
}

export function formatMissionDuration(start?: string | null, end?: string | null, now = Date.now()): string | null {
	const startTime = parseMissionTime(start);
	if (startTime === null) return null;
	const endTime = parseMissionTime(end) ?? now;
	const seconds = Math.max(0, Math.floor((endTime - startTime) / 1000));
	if (seconds < 60) return `${seconds} 秒`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return remainingSeconds ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分钟`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
}

export function formatMissionClock(value: string): string {
	const time = parseMissionTime(value);
	return time === null ? '' : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(time);
}

export function formatMissionDateTime(value: string): string {
	const time = parseMissionTime(value);
	return time === null ? '' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(time);
}

export function isSameMissionDay(first: number, second: number): boolean {
	const firstDate = new Date(first);
	const secondDate = new Date(second);
	return firstDate.getFullYear() === secondDate.getFullYear()
		&& firstDate.getMonth() === secondDate.getMonth()
		&& firstDate.getDate() === secondDate.getDate();
}

export function formatMissionDividerTime(value: string, now = Date.now()): string {
	const time = parseMissionTime(value);
	if (time === null) return '';
	const clock = formatMissionClock(value);
	const today = new Date(now);
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	const day = new Date(time);
	let dayLabel: string;
	if (isSameMissionDay(time, now)) dayLabel = '今天';
	else if (isSameMissionDay(time, yesterday.getTime())) dayLabel = '昨天';
	else dayLabel = new Intl.DateTimeFormat('zh-CN', {
		...(day.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' as const }),
		month: 'long', day: 'numeric',
	}).format(day);
	return `${dayLabel} ${clock}`;
}
