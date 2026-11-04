import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { DEFAULT_SCAN } from './scanDefaults';
import { suggestScanParameters } from './scanParameters';
import { EXAMPLE_SCAN_SPEED_KNOTS, readScanSpeed } from './scanSpeed';
import { missionScanApi } from '@/api/missionScan';
import type { ScanEnvironmentInfo, ScanRequest, ScanResult } from '@/api/missionScan';

type ScanField = 'west' | 'east' | 'south' | 'north' | 'spacing_m' | 'obstacle_buffer_m' | 'speed_knots' | 'start_lon' | 'start_lat' | 'end_lon' | 'end_lat';
type ScanDraft = Record<ScanField, string>;

function toDraft(request: ScanRequest): ScanDraft {
	const coordinate = (value: number | undefined | null) => value === undefined || value === null ? '' : value.toFixed(4);
	return {
		west: coordinate(request.west), east: coordinate(request.east), south: coordinate(request.south), north: coordinate(request.north),
		spacing_m: String(request.spacing_m), obstacle_buffer_m: String(request.obstacle_buffer_m),
		speed_knots: String(request.speed_knots ?? ''),
		start_lon: coordinate(request.start_point?.[0]), start_lat: coordinate(request.start_point?.[1]),
		end_lon: coordinate(request.end_point?.[0]), end_lat: coordinate(request.end_point?.[1]),
	};
}

function toRequest(draft: ScanDraft, hasImportedData = false): ScanRequest {
	return {
		west: Number(draft.west), south: Number(draft.south),
		east: Number(draft.east), north: Number(draft.north),
		spacing_m: Number(draft.spacing_m),
		obstacle_buffer_m: Number(draft.obstacle_buffer_m),
		...(draft.speed_knots.trim() ? { speed_knots: Number(draft.speed_knots) } : {}),
		...(draft.start_lon.trim() && draft.start_lat.trim() ? { start_point: [Number(draft.start_lon), Number(draft.start_lat)] as [number, number] } : {}),
		...(draft.end_lon.trim() && draft.end_lat.trim() ? { end_point: [Number(draft.end_lon), Number(draft.end_lat)] as [number, number] } : {}),
		use_requested_bounds: true,
		allow_bounds_only: !hasImportedData,
	};
}

function validateDraft(draft: ScanDraft): string {
	if (Object.entries(draft).some(([field, value]) => !['speed_knots', 'start_lon', 'start_lat', 'end_lon', 'end_lat'].includes(field) && !value.trim())) return '请填写全部参数。';
	const { west, south, east, north, spacing_m, obstacle_buffer_m, speed_knots } = toRequest(draft);
	if (![west, south, east, north, spacing_m, obstacle_buffer_m].every(Number.isFinite)) return '请输入有效数字。';
	if (west >= east) return `东侧经度 ${east} 必须大于西侧经度 ${west}。如果想在西侧 ${west} 的右边规划，可填 ${Number((west + 0.04).toFixed(4))}。`;
	if (south >= north) return `北侧纬度 ${north} 必须大于南侧纬度 ${south}。`;
	if (west < -180 || east > 180 || south < -90 || north > 90) return '经纬度超出 WGS84 范围。';
	if (spacing_m < 30 || spacing_m > 2000) return '扫描间距应在 30–2000 米之间。';
	if (obstacle_buffer_m < 0 || obstacle_buffer_m > 500) return '避障距离应在 0–500 米之间。';
	if (speed_knots !== undefined && (!Number.isFinite(speed_knots) || speed_knots <= 0)) return '预计航速应大于 0 节。';
	if (Boolean(draft.start_lon.trim()) !== Boolean(draft.start_lat.trim())) return '请同时填写起点经度和纬度。';
	if (draft.start_lon.trim() && draft.start_lat.trim()) {
		const lon = Number(draft.start_lon), lat = Number(draft.start_lat);
		if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < west || lon > east || lat < south || lat > north) return '起点必须位于扫描经纬度范围内。';
	}
	if (Boolean(draft.end_lon.trim()) !== Boolean(draft.end_lat.trim())) return '请同时填写终点经度和纬度。';
	if (draft.end_lon.trim() && draft.end_lat.trim()) {
		const lon = Number(draft.end_lon), lat = Number(draft.end_lat);
		if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < west || lon > east || lat < south || lat > north) return '终点必须位于扫描经纬度范围内。';
	}
	return '';
}

export function MissionScanPlanner({
	agentId,
	sessionId,
	result,
	onResult,
	onSpeedChange,
	coordinatePrefill,
	importedBounds,
}: {
	agentId?: string;
	sessionId?: string;
	result: ScanResult | null;
	onResult: (result: ScanResult) => void;
	onSpeedChange: (speed: number) => void;
	coordinatePrefill?: ScanRequest | null;
	importedBounds?: ScanEnvironmentInfo['bounds'];
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const lastPlanKey = useRef('');
	const manualSpacing = useRef(false);
	const manualBuffer = useRef(false);
	const [draft, setDraft] = useState<ScanDraft>(() => toDraft(DEFAULT_SCAN));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [useDemo, setUseDemo] = useState(false);

	useEffect(() => {
		const planKey = `${agentId ?? ''}:${sessionId ?? ''}:${result ? JSON.stringify([result.bounds, result.spacing_m, result.obstacle_buffer_m, result.path_length_m, result.start_point, result.end_point]) : 'new'}`;
		if (planKey === lastPlanKey.current) return;
		lastPlanKey.current = planKey;
		manualSpacing.current = false;
		manualBuffer.current = false;
		const speed_knots = readScanSpeed(agentId, sessionId, result?.speed_knots);
		setDraft(toDraft(result ? { ...result.bounds, spacing_m: result.spacing_m, obstacle_buffer_m: result.obstacle_buffer_m, speed_knots, start_point: result.start_point, end_point: result.end_point } : { ...DEFAULT_SCAN, speed_knots }));
	}, [agentId, sessionId, result]);
	useEffect(() => {
		if (!coordinatePrefill) return;
		manualSpacing.current = false;
		manualBuffer.current = false;
		setDraft(toDraft(coordinatePrefill));
	}, [coordinatePrefill]);
	useEffect(() => {
		if (!importedBounds || result || coordinatePrefill) return;
		// 大范围源文件只提供定位依据，避免直接规划数百公里的默认航迹。
		const isSmallArea = importedBounds.east - importedBounds.west <= 0.25
			&& importedBounds.north - importedBounds.south <= 0.25;
		const suggested = isSmallArea ? suggestScanParameters(importedBounds) : null;
		setDraft((current) => ({ ...current,
			west: isSmallArea ? importedBounds.west.toFixed(4) : '',
			east: isSmallArea ? importedBounds.east.toFixed(4) : '',
			south: isSmallArea ? importedBounds.south.toFixed(4) : '',
			north: isSmallArea ? importedBounds.north.toFixed(4) : '',
			spacing_m: String(suggested?.spacing_m ?? DEFAULT_SCAN.spacing_m),
			obstacle_buffer_m: String(suggested?.obstacle_buffer_m ?? DEFAULT_SCAN.obstacle_buffer_m),
		}));
	}, [importedBounds, result, coordinatePrefill]);

	const update = (field: ScanField, value: string) => {
		setUseDemo(false);
		if (field === 'spacing_m') manualSpacing.current = true;
		if (field === 'obstacle_buffer_m') manualBuffer.current = true;
		setDraft((current) => {
			const next = { ...current, [field]: value };
			if (field === 'west' || field === 'east' || field === 'south' || field === 'north') {
				const parameters = suggestScanParameters({
					west: Number(next.west), east: Number(next.east), south: Number(next.south), north: Number(next.north),
				});
				if (parameters && next.west && next.east && next.south && next.north) {
					if (!manualSpacing.current) next.spacing_m = String(parameters.spacing_m);
					if (!manualBuffer.current) next.obstacle_buffer_m = String(parameters.obstacle_buffer_m);
				}
			}
			return next;
		});
		if (field === 'speed_knots' && Number.isFinite(Number(value)) && Number(value) > 0) onSpeedChange(Number(value));
		setError('');
	};
	const validationError = validateDraft(draft);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!agentId || !sessionId) return;
		if (validationError) { setError(validationError); return; }
		setBusy(true);
		setError('');
		try {
			const next = await missionScanApi.create(agentId, sessionId, {
				...toRequest(draft, Boolean(importedBounds)),
				...(useDemo ? { use_demo: true } : {}),
			});
			onResult(next);
			dialogRef.current?.close();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : '规划失败');
		} finally {
			setBusy(false);
		}
	};

	return <>
		<button className="mission-scan-button" type="button" disabled={!agentId || !sessionId} onClick={() => { setDraft((current) => ({ ...current, speed_knots: String(readScanSpeed(agentId, sessionId, result?.speed_knots)) })); setUseDemo(false); setError(''); dialogRef.current?.showModal(); }}>
			{result ? '重新规划' : '规划扫描'}
		</button>
		<dialog className="mission-scan-dialog" ref={dialogRef} aria-labelledby="missionScanTitle">
			<form onSubmit={(event) => void submit(event)}>
				<h2 id="missionScanTitle">规划海域扫描航迹</h2>
				<p>填写 WGS84 搜索边界；间距和避障距离以米为单位。</p>
			{importedBounds && <p>已导入数据范围：经度 {importedBounds.west.toFixed(4)}°～{importedBounds.east.toFixed(4)}°，纬度 {importedBounds.south.toFixed(4)}°～{importedBounds.north.toFixed(4)}°。{importedBounds.east - importedBounds.west > 0.25 || importedBounds.north - importedBounds.south > 0.25 ? '文件覆盖范围较大，请在其内填写本次扫描区域。' : '已自动填入扫描范围。'}</p>}
				<div className="mission-scan-fields">
					{([
						['west', '西侧经度（°E）'], ['east', '东侧经度（°E）'],
						['south', '南侧纬度（°N）'], ['north', '北侧纬度（°N）'],
						['spacing_m', '扫描间距（米）'], ['obstacle_buffer_m', '避障距离（米）'],
						['speed_knots', '预计航速（节）'],
						['start_lon', '起点经度（可选）'], ['start_lat', '起点纬度（可选）'],
						['end_lon', '终点经度（可选）'], ['end_lat', '终点纬度（可选）'],
					] as [ScanField, string][]).map(([field, label]) =>
						<label key={field}>{label}<input type="number" step={field === 'spacing_m' ? '10' : field === 'obstacle_buffer_m' ? '5' : field === 'speed_knots' ? '0.1' : '0.0001'} min={field === 'speed_knots' ? '0.1' : undefined} required={!['speed_knots', 'start_lon', 'start_lat', 'end_lon', 'end_lat'].includes(field)} value={draft[field]} onChange={(event) => update(field, event.target.value)} /></label>
					)}
				</div>
				<p>间距和避障缓冲会随海域宽高给出建议值；传感器幅宽与实际航行安全距离仍需人工核定。</p>
				{(validationError || error) && <p className="mission-scan-error" role="alert">{validationError || error}</p>}
				<div className="mission-scan-actions">
					<button type="button" disabled={busy} onClick={() => {
						const parameters = suggestScanParameters({ west: Number(draft.west), east: Number(draft.east), south: Number(draft.south), north: Number(draft.north) });
						if (!parameters || !draft.west || !draft.east || !draft.south || !draft.north) return;
						manualSpacing.current = false;
						manualBuffer.current = false;
						setDraft((current) => ({ ...current, spacing_m: String(parameters.spacing_m), obstacle_buffer_m: String(parameters.obstacle_buffer_m) }));
					}}>按范围推荐</button>
					<button type="button" disabled={busy} onClick={() => { manualSpacing.current = false; manualBuffer.current = false; setDraft(toDraft(DEFAULT_SCAN)); onSpeedChange(EXAMPLE_SCAN_SPEED_KNOTS); setUseDemo(true); setError(''); }}>恢复示例值</button>
					<button type="button" disabled={busy} onClick={() => dialogRef.current?.close()}>取消</button>
					<button type="submit" disabled={busy || Boolean(validationError)}>{busy ? '规划中…' : '生成航迹'}</button>
				</div>
			</form>
		</dialog>
	</>;
}
