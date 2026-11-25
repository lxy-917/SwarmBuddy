import { ReplyFinishedReason } from '@agentscope-ai/agentscope/event';
import type { Msg, TextBlock } from '@agentscope-ai/agentscope/message';
import type { ContentBlock } from '@agentscope-ai/agentscope/message';
import katexStyles from 'katex/dist/katex.min.css?inline';
import {
	Activity,
	ArrowDown,
	BarChart3,
	Check,
	ChevronRight,
	Compass,
	Crosshair,
	LoaderCircle,
	Expand,
	Grid3X3,
	FolderOpen,
	MessageSquare,
	Copy,
	Eye,
	EyeOff,
	Pin,
	PinOff,
	Trash2,
	TriangleAlert,
	PanelLeftClose,
	PanelLeftOpen,
	PanelRightClose,
	PanelRightOpen,
	Pencil,
	Plus,
	Radar,
	Search,
	Sparkles,
	Route,
	ScanLine,
	CircleDot,
	X,
} from 'lucide-react';
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import './missionTableDialog.css';
import { scanMatchesCoordinates, scanPlanReport } from './missionChatActions';
import { buildMissionChatSnapshot, locateMissionObject, parseLocateRequest } from './missionChatBridge';
import { MissionComposer } from './MissionComposer';
import { MissionAnalysisPanel, MissionExecutionPanel, MissionTargetsPanel } from './MissionDashboardPanels';
import { MissionGamePanel } from './MissionGamePanel';
import { advanceSimulation, pauseSimulation, simulatedCoverage, simulationAssets, simulationInitial, startSimulation } from './missionCooperationSimulation';
import { commandFleetUav, releaseFleetUav, reportFleetObservation, respondFleetObservation } from './missionFleet';
import type { FleetUavCommand, FleetPoint } from './missionFleet';
import { MissionMessageActions } from './MissionMessageActions';
import { MissionMessageContent } from './MissionMessageContent';
import { missionActionContext } from './missionReplyActivity';
import { MissionReplyFrame, MissionReplyOverview } from './MissionReplyOverview';
import { advanceMultiGrid, multiGridInitial, multiGridSummary } from './missionMultiGrid';
import { UavIcon, UsvIcon } from './MissionPlatformIcons';
import { MissionScanMap } from './MissionScanMap';
import { MissionScanPlanner } from './MissionScanPlanner';
import { MissionScanDownloadSave, MissionScanSummary } from './MissionScanSummary';
import { MissionSituationAside, MissionSituationClock } from './MissionSituationAside';
import { formatMissionClock, formatMissionDateTime, formatMissionDividerTime, formatMissionDuration, isSameMissionDay } from './missionTime';
import { MissionToolCalls } from './MissionToolCalls';
import { MissionUserMessageActions } from './MissionUserMessageActions';
import { RobotAvatar } from './RobotAvatar';
import { createScanChatContextBlocks, isScanContextBlock } from './scanChatContext';
import { inferScanBounds, parseChatScanCoordinates } from './scanChatCoordinates';
import { DEFAULT_SCAN, hasDemoCoastline } from './scanDefaults';
import { suggestScanParameters } from './scanParameters';
import { readScanSpeed, saveScanSpeed } from './scanSpeed';
import type { ChatModelConfig } from '@/api';
import { ApiError, getBaseUrl } from '@/api/client';
import { missionScanApi } from '@/api/missionScan';
import type { MarineConditions, MarineObservations, MissionMapSelection, MissionTaskAssignment, MissionTaskEvent, ScanEnvironmentInfo, ScanGeoJSON, ScanRequest, ScanResult } from '@/api/missionScan';
import { SwarmAppRail } from '@/components/layout/SwarmAppRail';
import { AudioProvider } from '@/context/AudioContext';
import { useAgents } from '@/hooks/useAgents';
import { useAvailableModels } from '@/hooks/useAvailableModels';
import { useMessages } from '@/hooks/useMessages';
import { useSessions } from '@/hooks/useSessions';
import { COLLABORATION_AGENT_NAME } from '@/pages/collaboration/collaborationDraft';
import { readChatCredentialPreference } from '@/pages/credential/credentialPreference';
import { isKnowledgeChatAgent } from '@/pages/knowledge/knowledgeChat';

const FRAME_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#mission-root{min-height:100%;background:#061522}</style><style>${katexStyles}</style><link rel="stylesheet" href="/ocean/app/styles.css"><link rel="stylesheet" href="/ocean/app/integration.css?v=situation-board-30"><link rel="stylesheet" href="/ocean/app/dashboard.css"><link rel="stylesheet" href="/ocean/app/mission-replies.css"></head><body><div id="mission-root"></div></body></html>`;
const QUICK_CHAT_NAME = 'SwarmBuddy 快速问答';
const QUICK_CHAT_PROMPT = '你是 SwarmBuddy 的通用问答助手。';
const DEMO_BOAT_ROUTE = 'M538 53H299Q275 53 275 67Q275 81 299 81H655Q679 81 679 95Q679 109 655 109H311Q287 109 287 123Q287 137 311 137H688Q712 137 712 151Q712 165 688 165H581';

const SITUATION_TABS = [
	{ id: 'overview', label: '海域态势', title: '海域扫描任务', icon: Compass },
	{ id: 'execution', label: '任务执行', title: '任务执行', icon: Activity },
	{ id: 'analysis', label: '数据分析', title: '数据分析', icon: BarChart3 },
	{ id: 'targets', label: '目标识别', title: '目标识别', icon: Crosshair },
	{ id: 'game', label: '智能博弈', title: '智能博弈', icon: Radar },
] as const;
type SituationTab = (typeof SITUATION_TABS)[number]['id'];

type SidebarItem = { kind: 'agent' | 'session'; id: string; agentId: string; name: string };
type SidebarContextMenu = { item: SidebarItem; x: number; y: number };
type SidebarDialog = { item: SidebarItem; action: 'rename' | 'delete' };
type MessageSelection = { maxIndex: number; ids: Set<string> };

function readItemFlags(key: string): Record<string, boolean> {
	try {
		return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean>;
	} catch {
		return {};
	}
}

function messageText(message: Msg): string {
	const texts = message.content
		.filter((block): block is TextBlock => block.type === 'text' && !isScanContextBlock(block))
		.map((block) => block.text);
	const files = message.content
		.filter((block): block is Extract<ContentBlock, { type: 'data' }> => block.type === 'data' && !isScanContextBlock(block))
		.map((block) => `附件：${block.name ?? '文件'}`);
	return [...texts, ...files].join('\n');
}

function MissionThinkingIndicator({ stopping = false, startedAt }: { stopping?: boolean; startedAt?: string }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!startedAt) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [startedAt]);
	const elapsed = startedAt ? formatMissionDuration(startedAt, null, now) : null;
	const label = stopping ? '正在停止' : '正在思考';
	return <div className="mission-thinking-indicator" role="status" aria-label={label}>
		<LoaderCircle className="mission-thinking-spinner" size={16} aria-hidden="true" />
		<span className="mission-thinking-label">{label}{elapsed ? ` · ${elapsed}` : ''}</span>
	</div>;
}

function CredentialWorkspace({ agentId, sessionId }: { agentId?: string; sessionId?: string }) {
	const [loaded, setLoaded] = useState(false);
	return (
		<section className="credential-workspace panel" aria-label="凭证管理">
			{!loaded && <div className="credential-workspace-loading" role="status">正在加载凭证…</div>}
			<iframe
				className={loaded ? 'ready' : ''}
				src={`/credential-embed?agent_id=${encodeURIComponent(agentId ?? '')}&session_id=${encodeURIComponent(sessionId ?? '')}`}
				title="SwarmBuddy 凭证管理"
				onLoad={() => setLoaded(true)}
			/>
		</section>
	);
}

function MissionContent() {
	const navigate = useNavigate();
	const location = useLocation();
	const credentialMode = new URLSearchParams(location.search).get('view') === 'credential';
	const { agentId, sessionId } = useParams();
	const homeMode = !credentialMode && (new URLSearchParams(location.search).get('home') === '1' || location.pathname === '/mission');
	const { agents, loading: agentsLoading, error: agentsError, create: createAgent, update: updateAgent, remove: removeAgent } = useAgents();
	const quickChatAgent = agents.find((agent) => agent.data.name === QUICK_CHAT_NAME && agent.data.system_prompt === QUICK_CHAT_PROMPT);
	const conversationAgentId = agentId ?? (location.pathname === '/mission' ? quickChatAgent?.id : undefined);
	const {
		sessions,
		error: sessionsError,
		create: createSession,
		update: updateSession,
		remove: removeSession,
		refetch: refetchSessions,
	} = useSessions(conversationAgentId ?? null);
	const activeSession = sessions.find((view) => view.session.id === sessionId);
	const { groups: availableModels } = useAvailableModels();
	const {
		msgs,
		liveReplyIds,
		loading: messagesLoading,
		phase,
		error: messageError,
		send,
		deleteMessages,
		interrupt,
		onUserConfirm,
	} = useMessages(agentId ?? null, sessionId ?? null, {
		onSessionUpdated: () => { void refetchSessions(); },
	});
	const [creating, setCreating] = useState(false);
	const [changingModel, setChangingModel] = useState(false);
	const [editingAgentName, setEditingAgentName] = useState(false);
	const [agentNameDraft, setAgentNameDraft] = useState('');
	const [renamingAgent, setRenamingAgent] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [projectsOpen, setProjectsOpen] = useState(false);
	const [activePrimary, setActivePrimary] = useState<'ask' | 'projects'>(() => location.pathname === '/mission' || new URLSearchParams(location.search).get('home') === '1' ? 'ask' : 'projects');
	const [historySearchOpen, setHistorySearchOpen] = useState(false);
	const [historyCollapsed, setHistoryCollapsed] = useState(() => localStorage.getItem('swarmbuddy.historyCollapsed') === 'true');
	const [historyQuery, setHistoryQuery] = useState('');
	const [chatPanelWidth, setChatPanelWidth] = useState<number | null>(() => {
		const saved = Number(localStorage.getItem('swarmbuddy.missionChatWidth'));
		return Number.isFinite(saved) && saved >= 320 && saved <= 2400 ? saved : null;
	});
	const [resizingPanels, setResizingPanels] = useState(false);
	const workbenchRef = useRef<HTMLDivElement>(null);
	const chatPanelRef = useRef<HTMLElement>(null);
	const panelDrag = useRef<{ pointerX: number; width: number } | null>(null);
	const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(null);
	const [frameDocument, setFrameDocument] = useState<Document | null>(null);
	const [sidebarDialog, setSidebarDialog] = useState<SidebarDialog | null>(null);
	const [sidebarDialogName, setSidebarDialogName] = useState('');
	const [sidebarDialogBusy, setSidebarDialogBusy] = useState(false);
	const [projectDialogOpen, setProjectDialogOpen] = useState(false);
	const [projectName, setProjectName] = useState('');
	const [projectPrompt, setProjectPrompt] = useState('');
	const [sidebarNotice, setSidebarNotice] = useState<string | null>(null);
	const [homeModelConfig, setHomeModelConfig] = useState<ChatModelConfig | null>(null);
	const [preferredModelConfig, setPreferredModelConfig] = useState<ChatModelConfig | null>(() => readChatCredentialPreference());
	const [homeResetKey, setHomeResetKey] = useState(0);
	const [pendingHomeMessage, setPendingHomeMessage] = useState<{ sessionId: string; blocks: ContentBlock[] } | null>(null);
	const pendingImportSessionRef = useRef<{ agentId: string; sessionId: string } | null>(null);
	const [quotedMessage, setQuotedMessage] = useState<string | null>(null);
	const [messageSelection, setMessageSelection] = useState<MessageSelection | null>(null);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deletingSelected, setDeletingSelected] = useState(false);
	const [deleteSelectionError, setDeleteSelectionError] = useState<string | null>(null);
	const [pinnedProjects, setPinnedProjects] = useState(() => readItemFlags('swarmbuddy.pinnedProjects'));
	const [unreadProjects, setUnreadProjects] = useState(() => readItemFlags('swarmbuddy.unreadProjects'));
	const [mapMode, setMapMode] = useState<'route' | 'terrain'>('route');
	const [progressCollapsed, setProgressCollapsed] = useState(false);
	const [legendCollapsed, setLegendCollapsed] = useState(false);
	const [situationTab, setSituationTab] = useState<SituationTab>('overview');
	const { icon: SituationIcon, title: situationTitle } = SITUATION_TABS.find((tab) => tab.id === situationTab) ?? SITUATION_TABS[0];
	const [scanResult, setScanResult] = useState<ScanResult | null>(null);
	const [cooperation, setCooperation] = useState(simulationInitial);
	const [missionAssignment, setMissionAssignment] = useState<MissionTaskAssignment | null>(null);
	const [taskEvents, setTaskEvents] = useState<MissionTaskEvent[]>([]);
	const [taskEventError, setTaskEventError] = useState<string | null>(null);
	const [taskEventBusy, setTaskEventBusy] = useState(false);
	const previousDroneModes = useRef<Record<string, string>>({});
	const previousBoatModes = useRef<Record<string, string>>({});
	const explicitReturns = useRef<Set<string>>(new Set());
	const taskEventQueues = useRef<Record<string, Promise<unknown>>>({});
	const [multiGridEnabled, setMultiGridEnabled] = useState(false);
	const [multiGrid, setMultiGrid] = useState(multiGridInitial);
	const [selectedUsvId, setSelectedUsvId] = useState('USV-01');
	const [selectedMapObject, setSelectedMapObject] = useState<MissionMapSelection | null>(null);
	const [manualTargetUavId, setManualTargetUavId] = useState<string | null>(null);
	const [targetSelected, setTargetSelected] = useState(false);
	const [targetFocusToken, setTargetFocusToken] = useState(0);
	const [observationFocusPoint, setObservationFocusPoint] = useState<[number, number] | null>(null);
	const [marineConditions, setMarineConditions] = useState<MarineConditions | null>(null);
	const [marineObservations, setMarineObservations] = useState<MarineObservations | null>(null);
	const [observationState, setObservationState] = useState<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
	const [coordinatePrefill, setCoordinatePrefill] = useState<ScanRequest | null>(null);
	const [startingScanAnalysis, setStartingScanAnalysis] = useState(false);
	const [scanSpeedKnots, setScanSpeedKnots] = useState(() => readScanSpeed(agentId, sessionId));
	const [scanDataName, setScanDataName] = useState<string | null>(null);
	const [scanDataBounds, setScanDataBounds] = useState<ScanEnvironmentInfo['bounds']>(undefined);
	const [expanded, setExpanded] = useState(false);
	const [resultHidden, setResultHidden] = useState(
		() => localStorage.getItem('swarmbuddy.resultHidden') === 'true',
	);
	useEffect(() => {
		const onCredentialUpdate = (event: MessageEvent) => {
			if (event.origin !== window.location.origin || event.data?.type !== 'swarmbuddy:credential-selection-updated') return;
			setPreferredModelConfig(readChatCredentialPreference());
			void refetchSessions();
		};
		window.addEventListener('message', onCredentialUpdate);
		return () => window.removeEventListener('message', onCredentialUpdate);
	}, [refetchSessions]);
	const handleSituationTabKeys = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
		const last = SITUATION_TABS.length - 1;
		const keyIndices: Partial<Record<string, number>> = {
			ArrowLeft: index === 0 ? last : index - 1,
			ArrowRight: index === last ? 0 : index + 1,
			Home: 0,
			End: last,
		};
		const next = keyIndices[event.key];
		if (next === undefined) return;
		event.preventDefault();
		const tab = SITUATION_TABS[next].id;
		setSituationTab(tab);
		event.currentTarget.ownerDocument.getElementById('mission-tab-' + tab)?.focus();
	};

	const [sidebarCollapsed, setSidebarCollapsed] = useState(
		() => localStorage.getItem('swarmbuddy.historySidebarCollapsed') === 'true',
	);
	const sidebarRef = useRef<HTMLElement>(null);
	const mapFrameRef = useRef<HTMLDivElement>(null);
	const conversationRef = useRef<HTMLDivElement>(null);
	const followConversationRef = useRef(true);
	const jumpingToLatestRef = useRef(false);
	const conversationScrollFrame = useRef<number | null>(null);
	const [showLatestButton, setShowLatestButton] = useState(false);
	const historySearchRef = useRef<HTMLInputElement>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const sidebarDialogInputRef = useRef<HTMLInputElement>(null);
	const wasCredentialMode = useRef(credentialMode);

	useEffect(() => { setScanResult(null); setMarineConditions(null); setMarineObservations(null); setCoordinatePrefill(null); setScanSpeedKnots(readScanSpeed(agentId, sessionId)); }, [agentId, sessionId]);
	useEffect(() => {
		if (!agentId || !sessionId || !scanResult || scanResult.speed_knots === scanSpeedKnots) return;
		let active = true;
		const timer = window.setTimeout(() => {
			void missionScanApi.updateSpeed(agentId, sessionId, scanSpeedKnots).then((updated) => {
				if (active) setScanResult(updated);
			}).catch(() => {});
		}, 450);
		return () => { active = false; window.clearTimeout(timer); };
	}, [agentId, sessionId, scanResult, scanSpeedKnots]);
	useEffect(() => {
		setScanDataName(null);
		setScanDataBounds(undefined);
		if (!agentId || !sessionId) return;
		let active = true;
		void missionScanApi.getEnvironment(agentId, sessionId).then((info) => {
			if (active) { setScanDataName(info.filename); setScanDataBounds(info.bounds); }
		}).catch(() => {});
		return () => { active = false; };
	}, [agentId, sessionId]);
	useEffect(() => {
		if (!agentId || !sessionId || phase !== 'idle') return;
		let active = true;
		void missionScanApi.get(agentId, sessionId).then((result) => {
			if (active) {
				setScanSpeedKnots(readScanSpeed(agentId, sessionId, result.speed_knots));
				setScanResult(result);
			}
		}).catch(() => {});
		return () => { active = false; };
	}, [agentId, sessionId, msgs.length, phase]);
	const marineScanKey = scanResult ? `${scanResult.source}:${scanResult.bounds.west}:${scanResult.bounds.south}:${scanResult.bounds.east}:${scanResult.bounds.north}:${scanResult.path_length_m}:${scanResult.planner ?? ''}:${scanResult.map.routes?.map((route) => route.vessel_id).join(',') ?? ''}` : '';
	const currentTaskId = missionAssignment?.mission_id ?? (scanResult && agentId && sessionId ? `plan:${agentId}:${sessionId}:${marineScanKey}` : null);
	const scanResultForReset = useRef(scanResult);
	useEffect(() => { scanResultForReset.current = scanResult; }, [scanResult]);
	useEffect(() => { setCooperation(simulationInitial(scanResultForReset.current)); setMissionAssignment(null); setTaskEvents([]); setTaskEventError(null); setMultiGridEnabled(false); setMultiGrid(multiGridInitial()); setSelectedUsvId('USV-01'); setSelectedMapObject(null); setManualTargetUavId(null); setTargetSelected(false); setTargetFocusToken(0); setObservationFocusPoint(null); }, [agentId, sessionId, marineScanKey]);
	useEffect(() => { if (agentId && sessionId) void missionScanApi.clearChatState(agentId, sessionId).catch(() => {}); }, [agentId, sessionId]);
	useEffect(() => { setSelectedMapObject((current) => current?.mission_id === currentTaskId ? current : null); }, [currentTaskId]);
	useEffect(() => {
		if (!cooperation.fleet?.assigned || !agentId || !sessionId) { setMissionAssignment(null); return; }
		let active = true;
		void missionScanApi.assignFleet(agentId, sessionId, cooperation.fleet.selectedIds, cooperation.fleet.assignmentId ?? '').then((assignment) => {
			if (!active) return;
			setMissionAssignment(assignment);
			setTaskEvents(Object.values(assignment.events).reverse());
			setTaskEventError(null);
			setCooperation((current) => current.fleet?.assigned ? { ...current, fleet: { ...current.fleet, agentCoordination: true } } : current);
		}).catch((error) => { if (active) setTaskEventError(error instanceof Error ? error.message : 'Agent 协同初始化失败'); });
		return () => { active = false; };
	}, [agentId, sessionId, marineScanKey, cooperation.fleet?.assigned, cooperation.fleet?.assignmentId, cooperation.fleet?.selectedIds]);
	const postTaskEvent = useCallback(async (senderId: string, eventType: string, position: FleetPoint, payload: Record<string, unknown> = {}) => {
		if (!agentId || !sessionId || !missionAssignment) throw new Error('Agent 协同任务尚未就绪');
		const request = {
			event_id: crypto.randomUUID(), mission_id: missionAssignment.mission_id,
			sender_id: senderId, event_type: eventType, timestamp: new Date().toISOString(),
			position, payload,
		};
		// Preserve each UAV's return -> returned order even across network delays.
		const pending = taskEventQueues.current[senderId] ?? Promise.resolve();
		const submitted = pending.catch(() => {}).then(() => missionScanApi.submitFleetEvent(agentId, sessionId, request));
		taskEventQueues.current[senderId] = submitted;
		const event = await submitted;
		setTaskEvents((current) => [event, ...current.filter((item) => item.event_id !== event.event_id)].slice(0, 40));
		setTaskEventError(event.status === 'rejected' ? event.chain.at(-1)?.detail ?? '任务事件被拒绝' : null);
		return event;
	}, [agentId, sessionId, missionAssignment]);
	const taskFailure = useCallback((error: unknown) => setTaskEventError(error instanceof Error ? error.message : 'Agent 协同服务暂不可用'), []);
	const releaseMissionUav = useCallback((carrierId: string) => {
		const fleet = cooperation.fleet;
		const boat = fleet?.boats.find((item) => item.id === carrierId);
		const drone = fleet?.drones.find((item) => item.carrierId === carrierId);
		if (!boat || !drone || !missionAssignment) return;
		setTaskEventBusy(true);
		void postTaskEvent(drone.id, 'UAV_RELEASED', boat.position).then((event) => {
			if (event.status === 'completed') setCooperation((current) => current.fleet ? { ...current, fleet: releaseFleetUav(current.fleet, carrierId, current.second) } : current);
		}).catch(taskFailure).finally(() => setTaskEventBusy(false));
	}, [cooperation.fleet, missionAssignment, postTaskEvent, taskFailure]);
	const reportMissionTarget = useCallback((droneId: string) => {
		const drone = cooperation.fleet?.drones.find((item) => item.id === droneId);
		if (!drone || !missionAssignment) return;
		setTaskEventBusy(true);
		void postTaskEvent(droneId, 'TARGET_SUSPECTED', drone.position, { mission_paused: !cooperation.running }).then((event) => {
			if (event.status !== 'completed' && event.status !== 'deferred') return;
			setCooperation((current) => {
				if (!current.fleet) return current;
				let fleet = reportFleetObservation(current.fleet, droneId, current.second, event.timestamp, event.event_id, event.recipient_ids);
				for (const action of event.actions) if (action.boat_id && (action.action === 'verify' || action.action === 'pause')) fleet = respondFleetObservation(fleet, action.boat_id, event.event_id, action.action, current.second);
				return { ...current, fleet };
			});
		}).catch(taskFailure).finally(() => setTaskEventBusy(false));
	}, [cooperation.fleet, cooperation.running, missionAssignment, postTaskEvent, taskFailure]);
	const respondMissionObservation = useCallback((boatId: string, observationId: string, action: 'pause' | 'verify' | 'continue') => {
		const fleet = cooperation.fleet;
		const boat = fleet?.boats.find((item) => item.id === boatId);
		const observation = fleet?.observations.find((item) => item.id === observationId);
		if (!boat || !observation || !missionAssignment) return;
		const eventType = action === 'pause' ? 'MISSION_PAUSED' : action === 'verify' ? 'VERIFY_REQUESTED' : 'MISSION_RESUMED';
		setTaskEventBusy(true);
		void postTaskEvent(boatId, eventType, action === 'verify' ? observation.position : boat.position, { observation_id: observationId }).then((event) => {
			if (event.status === 'completed') setCooperation((current) => current.fleet ? { ...current, fleet: respondFleetObservation(current.fleet, boatId, observationId, action, current.second) } : current);
		}).catch(taskFailure).finally(() => setTaskEventBusy(false));
	}, [cooperation.fleet, missionAssignment, postTaskEvent, taskFailure]);
	const commandMissionUav = useCallback((id: string, command: FleetUavCommand, values?: { speedMps?: number; headingDegrees?: number; altitudeM?: number; target?: FleetPoint | null }) => {
		const drone = cooperation.fleet?.drones.find((item) => item.id === id);
		if (!drone || !missionAssignment) return;
		if (command === 'return' && missionAssignment) {
			void postTaskEvent(id, 'UAV_RETURNING', drone.position).then((event) => {
				if (event.status === 'completed') { explicitReturns.current.add(id); setCooperation((current) => current.fleet ? { ...current, fleet: commandFleetUav(current.fleet, id, command, current.second, values) } : current); }
			}).catch(taskFailure);
			return;
		}
		void postTaskEvent(id, 'UAV_COMMAND_REQUESTED', drone.position, { command, ...values }).then((event) => {
			if (event.status === 'completed') setCooperation((current) => current.fleet ? { ...current, fleet: commandFleetUav(current.fleet, id, command, current.second, values) } : current);
		}).catch(taskFailure);
	}, [cooperation.fleet, missionAssignment, postTaskEvent, taskFailure]);
	const toggleMissionSimulation = useCallback(() => {
		if (!scanResult || (cooperation.fleet && !missionAssignment)) return;
		const pausing = cooperation.running;
		setCooperation((current) => current.running ? pauseSimulation(current) : startSimulation(current, scanResult));
		if (missionAssignment) void postTaskEvent('coordinator', pausing ? 'MISSION_PAUSED' : 'MISSION_RESUMED', [0, 0]).catch(taskFailure);
	}, [scanResult, cooperation.fleet, cooperation.running, missionAssignment, postTaskEvent, taskFailure]);
	useEffect(() => {
		if (!missionAssignment || !cooperation.fleet) { previousDroneModes.current = {}; return; }
		const nextModes: Record<string, string> = {};
		for (const drone of cooperation.fleet.drones) {
			const previous = previousDroneModes.current[drone.id];
			nextModes[drone.id] = drone.mode;
			if (previous && previous !== 'return' && drone.mode === 'return') {
				if (explicitReturns.current.delete(drone.id)) continue;
				void postTaskEvent(drone.id, drone.battery <= 35 ? 'UAV_LOW_BATTERY' : 'UAV_RETURNING', drone.position, { battery: drone.battery }).catch(taskFailure);
			}
			if (previous === 'return' && drone.mode === 'deck') {
				void postTaskEvent(drone.id, 'UAV_RETURNED', drone.position).catch(taskFailure);
			}
		}
		previousDroneModes.current = nextModes;
	}, [cooperation.fleet, missionAssignment, postTaskEvent, taskFailure]);
	useEffect(() => {
		if (!missionAssignment || !cooperation.fleet) { previousBoatModes.current = {}; return; }
		const nextModes: Record<string, string> = {};
		for (const boat of cooperation.fleet.boats) {
			const previous = previousBoatModes.current[boat.id];
			nextModes[boat.id] = boat.mode;
			if (previous === 'verify' && boat.mode === 'paused' && boat.observationId) {
				void postTaskEvent(boat.id, 'VERIFY_COMPLETED', boat.position, { observation_id: boat.observationId }).catch(taskFailure);
			}
		}
		previousBoatModes.current = nextModes;
	}, [cooperation.fleet, missionAssignment, postTaskEvent, taskFailure]);
	useEffect(() => {
		if (!multiGridEnabled || !scanResult || cooperation.second - multiGrid.lastSecond < .2) return;
		setMultiGrid((current) => advanceMultiGrid(current, simulationAssets(scanResult, cooperation), cooperation.second));
	}, [multiGridEnabled, multiGrid.lastSecond, scanResult, cooperation]);
	useEffect(() => {
		if (cooperation.second === 0 && multiGrid.lastSecond > 0) setMultiGrid(multiGridInitial());
	}, [cooperation.second, multiGrid.lastSecond]);
	const multiGridStats = multiGridSummary(multiGrid);
	const focusTrainingTarget = useCallback(() => { if (currentTaskId) setSelectedMapObject({ kind: 'target', id: 'latest', mission_id: currentTaskId }); setObservationFocusPoint(null); setTargetSelected(true); setTargetFocusToken((value) => value + 1); }, [currentTaskId]);
	const focusObservation = useCallback((point: FleetPoint, id = 'latest') => {
		if (currentTaskId) setSelectedMapObject({ kind: 'target', id, mission_id: currentTaskId });
		setObservationFocusPoint(point);
		setTargetSelected(true);
		setTargetFocusToken((value) => value + 1);
	}, [currentTaskId]);
	const openSituationOverview = (expand = false) => {
		setSituationTab('overview');
		if (expand) setExpanded(true);
		frameDocument?.getElementById('mission-tab-overview')?.focus();
	};
	const locateDashboardTarget = (id: string, point: FleetPoint) => {
		setMapMode('route');
		openSituationOverview();
		if (id === 'latest') focusTrainingTarget();
		else focusObservation(point, id);
	};
	useEffect(() => {
		if (!cooperation.running || !scanResult || phase !== 'idle') return;
		let frame = 0;
		let lastUpdate = 0;
		const animate = (now: number) => {
			if (!lastUpdate) lastUpdate = now;
			const elapsed = (now - lastUpdate) / 1000;
			if (elapsed >= 1 / 30) {
				lastUpdate = now;
				setCooperation((current) => advanceSimulation(current, elapsed, scanResult, scanSpeedKnots));
			}
			frame = window.requestAnimationFrame(animate);
		};
		frame = window.requestAnimationFrame(animate);
		return () => window.cancelAnimationFrame(frame);
	}, [cooperation.running, scanResult, scanSpeedKnots, phase]);
	useEffect(() => {
		setMarineConditions(null);
		if (!agentId || !sessionId || !marineScanKey || scanResult?.source === 'demo') {
			return;
		}
		let active = true;
		const refresh = () => {
			void missionScanApi.getConditions(agentId, sessionId).then((conditions) => {
				if (!active) return;
				setMarineConditions(conditions);
			}).catch(() => {
				if (!active) return;
				setMarineConditions(null);
			});
		};
		refresh();
		const timer = window.setInterval(refresh, 15 * 60 * 1000);
		return () => { active = false; window.clearInterval(timer); };
	}, [agentId, sessionId, marineScanKey, scanResult?.source]);
	useEffect(() => {
		setMarineObservations(null);
		if (!agentId || !sessionId || !marineScanKey) {
			setObservationState('idle');
			return;
		}
		let active = true;
		const refresh = () => {
			setObservationState('loading');
			void missionScanApi.getObservations(agentId, sessionId).then((observations) => {
				if (!active) return;
				setMarineObservations(observations);
				setObservationState(observations.status === 'observed' ? 'ready' : 'unavailable');
			}).catch(() => {
				if (!active) return;
				setMarineObservations(null);
				setObservationState('error');
			});
		};
		refresh();
		const timer = window.setInterval(refresh, 5 * 60 * 1000);
		return () => { active = false; window.clearInterval(timer); };
	}, [agentId, sessionId, marineScanKey, scanResult?.source]);

	useEffect(() => { setFrameDocument(sidebarRef.current?.ownerDocument ?? null); }, []);
	useEffect(() => { setHomeModelConfig(null); }, [agentId]);
	useEffect(() => {
		if (sessionId || (agentId && pendingImportSessionRef.current?.agentId !== agentId)) pendingImportSessionRef.current = null;
	}, [agentId, sessionId]);
	useEffect(() => { setQuotedMessage(null); }, [agentId, sessionId]);
	useEffect(() => { setMessageSelection(null); setDeleteDialogOpen(false); }, [agentId, sessionId]);
	useEffect(() => {
		if (agentId && quickChatAgent?.id === agentId) setActivePrimary('ask');
	}, [agentId, quickChatAgent?.id]);

	useEffect(() => {
		if (wasCredentialMode.current && !credentialMode) void refetchSessions();
		wasCredentialMode.current = credentialMode;
	}, [credentialMode, refetchSessions]);

	useEffect(() => {
		if (agentsLoading || !agentId) return;
		const requestedAgent = agents.find((agent) => agent.id === agentId);
		if (requestedAgent?.data.name === COLLABORATION_AGENT_NAME) {
			navigate('/collaboration', { replace: true });
		} else if (requestedAgent && isKnowledgeChatAgent(requestedAgent.data.name)) {
			navigate('/knowledge', { replace: true });
		} else if (!requestedAgent) {
			navigate('/mission', { replace: true });
		}
	}, [agentId, agents, agentsLoading, navigate]);

	useEffect(() => {
		if (!agentId || sessions.length === 0 || creating) return;
		if (!sessionId || !sessions.some((view) => view.session.id === sessionId)) {
			navigate(`/mission/${agentId}/${sessions[0].session.id}${location.search}`, { replace: true });
		}
	}, [agentId, sessionId, sessions, creating, location.search, navigate]);

	useEffect(() => {
		followConversationRef.current = true;
		jumpingToLatestRef.current = false;
		setShowLatestButton(false);
	}, [agentId, sessionId]);
	useEffect(() => {
		if (!followConversationRef.current || !conversationRef.current) return;
		if (conversationScrollFrame.current !== null) cancelAnimationFrame(conversationScrollFrame.current);
		conversationScrollFrame.current = requestAnimationFrame(() => {
			const panel = conversationRef.current;
			if (panel && followConversationRef.current) panel.scrollTop = panel.scrollHeight;
			conversationScrollFrame.current = null;
		});
		return () => {
			if (conversationScrollFrame.current !== null) cancelAnimationFrame(conversationScrollFrame.current);
		};
	}, [msgs]);
	const handleConversationScroll = () => {
		const panel = conversationRef.current;
		if (!panel) return;
		const distance = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
		if (jumpingToLatestRef.current) {
			if (distance < 8) jumpingToLatestRef.current = false;
			return;
		}
		const nearBottom = distance < (followConversationRef.current ? 72 : 8);
		followConversationRef.current = nearBottom;
		setShowLatestButton(!nearBottom);
	};
	const scrollToLatest = () => {
		followConversationRef.current = true;
		jumpingToLatestRef.current = true;
		setShowLatestButton(false);
		conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: 'smooth' });
	};

	useEffect(() => {
		localStorage.setItem('swarmbuddy.historySidebarCollapsed', String(sidebarCollapsed));
	}, [sidebarCollapsed]);
	useEffect(() => {
		localStorage.setItem('swarmbuddy.historyCollapsed', String(historyCollapsed));
	}, [historyCollapsed]);

	useEffect(() => {
		localStorage.setItem('swarmbuddy.resultHidden', String(resultHidden));
	}, [resultHidden]);

	useEffect(() => { localStorage.setItem('swarmbuddy.pinnedProjects', JSON.stringify(pinnedProjects)); }, [pinnedProjects]);
	useEffect(() => { localStorage.setItem('swarmbuddy.unreadProjects', JSON.stringify(unreadProjects)); }, [unreadProjects]);
	useEffect(() => {
		if (!contextMenu) return;
		contextMenuRef.current?.querySelector('button')?.focus();
		const doc = sidebarRef.current?.ownerDocument;
		if (!doc) return;
		const close = (event: PointerEvent) => {
			if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
		};
		const escape = (event: globalThis.KeyboardEvent) => {
			if (event.key === 'Escape') setContextMenu(null);
		};
		doc.addEventListener('pointerdown', close);
		doc.addEventListener('keydown', escape);
		return () => { doc.removeEventListener('pointerdown', close); doc.removeEventListener('keydown', escape); };
	}, [contextMenu]);
	useEffect(() => { if (sidebarDialog?.action === 'rename') sidebarDialogInputRef.current?.focus(); }, [sidebarDialog]);


	const hasModel = Boolean(activeSession?.session.config.chat_model_config?.model);
	const lastUserIndex = msgs.findLastIndex((message) => message.role === 'user');
	const lastAssistant = msgs.slice(lastUserIndex + 1).findLast((message) => message.role === 'assistant');
	const displayMsgs = msgs;
	// 每次流式更新只线性扫描一次历史消息，避免逐条回溯造成平方级开销。
	const previousUserById = useMemo(() => {
		const previous = new Map<string, Msg>();
		let latestUser: Msg | undefined;
		for (const message of displayMsgs) {
			if (latestUser) previous.set(message.id, latestUser);
			if (message.role === 'user') latestUser = message;
		}
		return previous;
	}, [displayMsgs]);
	const isRunning = phase !== 'idle';
	const activeAgent = agents.find((agent) => agent.id === agentId);
	const availableChatModels = Object.entries(availableModels).flatMap(([type, records]) =>
		records.flatMap(({ credential, models }) => models
			.filter((model) => model.type === 'chat_model' && model.status === 'active')
			.map((model) => ({ type, credentialId: credential.id, model }))),
	);
	const defaultChoice = availableChatModels.find((choice) => choice.type === 'dashscope_credential' && choice.model.name === 'deepseek-v4-flash')
		?? availableChatModels.find((choice) => choice.model.input_types.some((type) => type.startsWith('image/')))
		?? availableChatModels[0];
	const defaultProperties = (defaultChoice?.model.parameter_schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
	const defaultProjectModel: ChatModelConfig | null = defaultChoice ? {
		type: defaultChoice.type,
		credential_id: defaultChoice.credentialId,
		model: defaultChoice.model.name,
		parameters: {
			...(Object.hasOwn(defaultProperties, 'thinking_enable') ? { thinking_enable: true } : {}),
			...(defaultChoice.type === 'dashscope_credential' && Object.hasOwn(defaultProperties, 'search_enable') ? { search_enable: false } : {}),
		},
	} : null;
	const preferredChoice = availableChatModels.find((choice) => choice.type === preferredModelConfig?.type && choice.credentialId === preferredModelConfig.credential_id && choice.model.name === preferredModelConfig.model);
	const homeSelectedModel = homeModelConfig ?? activeSession?.session.config.chat_model_config ?? (preferredChoice ? preferredModelConfig : null) ?? sessions[0]?.session.config.chat_model_config ?? defaultProjectModel;
	const canSend = Boolean(agentId && (sessionId ? hasModel && !messagesLoading && !isRunning && !changingModel : homeSelectedModel?.model && !creating));
	const activeModel = availableChatModels.find((choice) => choice.type === activeSession?.session.config.chat_model_config?.type
		&& choice.credentialId === activeSession?.session.config.chat_model_config?.credential_id
		&& choice.model.name === activeSession?.session.config.chat_model_config?.model);
	const supportsScanImage = Boolean(activeModel?.model.input_types.some((type) => type === '*/*' || type.startsWith('image/')));
	const sendWithCurrentScan = useCallback(async (blocks: ContentBlock[], selectionOverride?: MissionMapSelection | null) => {
		const result = agentId && sessionId ? await missionScanApi.get(agentId, sessionId).catch((error: unknown) => {
			if (error instanceof ApiError && error.status === 404) return null;
			throw error;
		}) : null;
		if (!result) {
			const now = new Date().toISOString();
			const missing: TextBlock = { id: crypto.randomUUID(), type: 'text', created_at: now,
				text: `[SwarmBuddyMissionContext JSON]\n${JSON.stringify({ mission_id: null, scan_status: 'not_found', simulation_status: 'unavailable', selected: null })}\n当前会话没有已保存的扫描方案；请调用 ReadOceanScanResult 核实，不要引用其他会话或猜测资产状态。` };
			await send([...blocks, missing]);
			return;
		}
		const currentSelection = (selectionOverride ?? selectedMapObject)?.mission_id === currentTaskId ? (selectionOverride ?? selectedMapObject) : null;
		let stateContext: object = { mission_id: currentTaskId, selected: currentSelection ? { kind: currentSelection.kind, id: currentSelection.id } : null, simulation_status: 'unavailable' };
		if (missionAssignment && cooperation.fleet?.assigned) {
			const snapshot = buildMissionChatSnapshot(missionAssignment.mission_id, cooperation.fleet, currentSelection);
			try {
				await missionScanApi.saveChatState(agentId!, sessionId!, snapshot);
				stateContext = { mission_id: snapshot.mission_id, selected: snapshot.selected,
					simulation_status: 'ready', state_tool: 'ReadMissionSituation', scan_tool: 'ReadOceanScanResult',
					labels: { assets: '仿真', observations: '仿真', progress: '仿真进度', planned_coverage_percent: '规划预计' } };
			} catch {
				await missionScanApi.clearChatState(agentId!, sessionId!);
				stateContext = { mission_id: currentTaskId, selected: currentSelection ? { kind: currentSelection.kind, id: currentSelection.id } : null,
					simulation_status: 'plan_mismatch', scan_tool: 'ReadOceanScanResult' };
			}
		} else await missionScanApi.clearChatState(agentId!, sessionId!);
		const context = await createScanChatContextBlocks(result, mapFrameRef.current, supportsScanImage);
		const now = new Date().toISOString();
		const structured: TextBlock = { id: crypto.randomUUID(), type: 'text', created_at: now,
			text: `[SwarmBuddyMissionContext JSON]\n${JSON.stringify(stateContext)}\n位置、电量、训练目标和执行进度仅为仿真；覆盖率是规划预计。需要当前扫描指标时调用 ReadOceanScanResult，需要仿真状态时调用 ReadMissionSituation。` };
		await send([...blocks, ...context, structured]);
	}, [agentId, sessionId, missionAssignment, cooperation.fleet, selectedMapObject, currentTaskId, send, supportsScanImage]);
	const canAnalyzeScan = Boolean(scanResult && sessionId && canSend && !startingScanAnalysis);
	const analyzeScan = async () => {
		if (!canAnalyzeScan || !agentId || !sessionId || !scanResult) return;
		setStartingScanAnalysis(true);
		setActionError(null);
		try {
			// 模型读取已保存的方案；发起分析前先保存界面上显示的航速。
			if (scanResult.speed_knots !== scanSpeedKnots) {
				const updated = await missionScanApi.updateSpeed(agentId, sessionId, scanSpeedKnots);
				setScanResult(updated);
			}
			setExpanded(false);
			const now = new Date().toISOString();
			await sendWithCurrentScan([{
				id: crypto.randomUUID(),
				type: 'text',
				text: '请对右侧当前海域扫描方案进行评估。请依据规划数据，说明区域覆盖情况、航线长度与预计作业时间、障碍物避让情况，并提出需要进一步核验的关键事项。对于现有数据不足以支持的判断，请明确说明。',
				created_at: now,
				finished_at: now,
			}]);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : '分析请求发送失败');
		} finally {
			setStartingScanAnalysis(false);
		}
	};
	const onOpenReplyAnalysis = useCallback(() => {
		setResultHidden(false);
		setExpanded(false);
		setSituationTab('analysis');
		frameDocument?.defaultView?.requestAnimationFrame(() => {
			frameDocument.getElementById('mission-tab-analysis')?.focus();
		});
	}, [frameDocument]);
	const currentModel = activeSession?.session.config.chat_model_config?.model;
	const sendActionReport = useCallback(async (input: string, report: unknown, selection?: MissionMapSelection | null) => {
		const now = new Date().toISOString();
		await sendWithCurrentScan([
			{ id: crypto.randomUUID(), type: 'text', text: input, created_at: now },
			{ id: crypto.randomUUID(), type: 'text', created_at: now,
				text: missionActionContext(report) },
		], selection);
	}, [sendWithCurrentScan]);
	const sendWithScanCoordinates = useCallback(async (blocks: ContentBlock[]) => {
		if (blocks.some((block) => block.type !== 'text')) {
			await sendWithCurrentScan(blocks);
			return;
		}
		const input = blocks.filter((block): block is TextBlock => block.type === 'text' && !block.text.startsWith('[File:'))
			.map((block) => block.text).join('\n');
		const locate = parseLocateRequest(input);
		const currentSelection = selectedMapObject?.mission_id === currentTaskId ? selectedMapObject : null;
		if (locate) {
			let current: ScanResult | null;
			try { current = agentId && sessionId ? await missionScanApi.get(agentId, sessionId) : null; }
			catch (error) {
				if (!(error instanceof ApiError && error.status === 404)) { await sendActionReport(input, '当前会话扫描结果读取失败，请检查后端服务后重试。'); return; }
				current = null;
			}
			let verifiedFleet = null;
			if (current && missionAssignment && cooperation.fleet?.assigned) {
				try {
					await missionScanApi.saveChatState(agentId!, sessionId!, buildMissionChatSnapshot(missionAssignment.mission_id, cooperation.fleet, currentSelection));
					verifiedFleet = cooperation.fleet;
				} catch { await sendActionReport(input, '当前仿真状态与该会话的扫描方案不匹配，无法可靠回答；请重新分配任务。'); return; }
			}
			if (locate) {
				const found = locateMissionObject(locate, current, verifiedFleet);
				if ('error' in found) { await sendActionReport(input, found.error); return; }
				setSelectedMapObject(currentTaskId ? { kind: locate.kind, id: found.id, mission_id: currentTaskId } : null);
				if (locate.kind === 'usv' || locate.kind === 'region') setSelectedUsvId(locate.id);
				setObservationFocusPoint(found.position);
				setTargetSelected(locate.kind === 'target');
				setTargetFocusToken((value) => value + 1);
				setResultHidden(false);
				await sendActionReport(input, { operation: 'map_locate', status: 'completed', object_type: locate.kind,
					object_id: found.id, position: found.position, position_coordinate_system: 'internal_map_xy_1000x625' },
					currentTaskId ? { kind: locate.kind, id: found.id, mission_id: currentTaskId } : null);
				return;
			}
		}
		const asksAboutScan = /为什么|为何|怎么|如何|解释|分析|评价|是否|合理吗|多少|几个|哪里|什么原因/.test(input);
		const explicitlyRequestsPlan = /(?:请|帮我|给我|直接|重新).{0,16}(?:生成|规划|重算|创建)/.test(input);
		const optimizeRoute = /最优|优化|最短|更短|缩短/.test(input) && /路径|航线|扫描|搜索/.test(input) && (!asksAboutScan || explicitlyRequestsPlan);
		const coordinates = asksAboutScan && !explicitlyRequestsPlan ? null : parseChatScanCoordinates(input);
		if (!coordinates && optimizeRoute && agentId && sessionId) {
			let report: unknown;
			try {
				const current = scanResult ?? await missionScanApi.get(agentId, sessionId).catch(() => null);
				if (!current) {
					report = { operation: 'route_optimization', status: 'not_started', reason: 'no_scan_plan' };
				} else if (current.planner === 'darp_python') {
					report = { operation: 'route_optimization', status: 'unsupported', planner: current.planner,
						reason: 'DARP second-pass route optimization is not implemented; the existing plan is unchanged.' };
				} else {
					const next = await missionScanApi.create(agentId, sessionId, {
						...current.bounds,
						spacing_m: current.spacing_m,
						obstacle_buffer_m: current.obstacle_buffer_m,
						vessel_count: current.vessel_count ?? 3,
						speed_knots: scanSpeedKnots,
						start_point: current.start_point,
						end_point: current.end_point,
						use_requested_bounds: true,
						allow_bounds_only: current.source === 'bounds_only',
						use_demo: current.source === 'demo',
						optimize_route: true,
					});
					setScanResult(next);
					setResultHidden(false);
					report = scanPlanReport(next);
				}
			} catch (cause) {
				const detail = cause instanceof ApiError && cause.status === 0
					? `无法连接规划服务（当前地址：${getBaseUrl() || '未配置'}）。请在系统设置中核对服务器地址，本机后端应为 http://localhost:8000。`
					: cause instanceof Error ? cause.message : '请稍后重试。';
				report = { operation: 'route_optimization', status: 'failed', reason: detail };
			}
			await sendActionReport(input, report);
			return;
		}
		if (!coordinates || !agentId || !sessionId) {
			await sendWithCurrentScan(blocks);
			return;
		}
		const currentScan = scanResult ?? await missionScanApi.get(agentId, sessionId).catch(() => null);
		const currentBounds = currentScan?.bounds;
		const withinCurrent = (point: [number, number]) => currentBounds && point[0] >= currentBounds.west && point[0] <= currentBounds.east && point[1] >= currentBounds.south && point[1] <= currentBounds.north;
		const reuseCurrent = currentBounds && (!coordinates.startPoint || withinCurrent(coordinates.startPoint)) && (!coordinates.endPoint || withinCurrent(coordinates.endPoint));
		const inferred = !coordinates.bounds && !reuseCurrent && (coordinates.startPoint || coordinates.endPoint)
			? inferScanBounds(coordinates.startPoint ?? coordinates.endPoint!, coordinates.endPoint ?? coordinates.startPoint!)
			: null;
		const bounds = coordinates.bounds ?? (reuseCurrent ? currentBounds : undefined) ?? inferred?.bounds;
		if (coordinates.error || inferred?.error || !bounds) {
			await sendActionReport(input, coordinates.error ?? inferred?.error ?? '已识别经纬度，请补充扫描区域边界。');
			return;
		}
		const previousStart = currentScan?.start_point;
		const previousEnd = currentScan?.end_point;
		const fits = (point: [number, number]) => point[0] >= bounds.west && point[0] <= bounds.east && point[1] >= bounds.south && point[1] <= bounds.north;
		const startPoint = coordinates.startPoint ?? (!coordinates.centerPoint && previousStart && fits(previousStart) ? previousStart : null);
		const endPoint = coordinates.endPoint ?? (!coordinates.centerPoint && previousEnd && fits(previousEnd) ? previousEnd : null);
		// 已导入资料时要求规划器与导入区域求交，避免不相交时悄悄退化为仅按边界规划。
		const hasImportedEnvironment = Boolean(scanDataName) || await missionScanApi.getEnvironment(agentId, sessionId).then(() => true).catch((error: unknown) => {
			if (error instanceof ApiError && error.status === 404) return false;
			throw error;
		});
		const request: ScanRequest = {
			west: bounds.west, east: bounds.east, south: bounds.south, north: bounds.north,
			...(currentBounds && bounds.west === currentBounds.west && bounds.east === currentBounds.east && bounds.south === currentBounds.south && bounds.north === currentBounds.north
				? { spacing_m: currentScan!.spacing_m, obstacle_buffer_m: currentScan!.obstacle_buffer_m }
				: suggestScanParameters(bounds) ?? { spacing_m: DEFAULT_SCAN.spacing_m, obstacle_buffer_m: DEFAULT_SCAN.obstacle_buffer_m }),
			vessel_count: currentScan?.vessel_count ?? DEFAULT_SCAN.vessel_count,
			speed_knots: scanSpeedKnots,
			start_point: startPoint,
			end_point: endPoint,
			use_requested_bounds: true,
			allow_bounds_only: !hasImportedEnvironment && !hasDemoCoastline(bounds),
			optimize_route: false, // DARP currently has no second-pass route optimizer.
		};
		setCoordinatePrefill(request);
		setResultHidden(false);
		let report: unknown;
		try {
			let next: ScanResult;
			try {
				next = await missionScanApi.create(agentId, sessionId, request);
			} catch (createError) {
				// 服务端可能已保存方案但连接中断，因此先读取已保存的结果。
				const saved = await missionScanApi.get(agentId, sessionId).catch(() => null);
				if (!saved || !scanMatchesCoordinates(saved, { ...coordinates, bounds })) throw createError;
				next = saved;
			}
			setScanResult(next);
			report = scanPlanReport(next, Boolean(coordinates.derivedBounds || inferred?.derivedBounds), coordinates.radiusKm);
		} catch (cause) {
			const detail = cause instanceof ApiError && cause.status === 0
				? `无法连接规划服务（当前地址：${getBaseUrl() || '未配置'}）。请检查设置中的服务器地址；本机启动时通常为 http://localhost:8000。`
				: cause instanceof Error ? cause.message : '请检查区域与起终点。';
			report = { operation: 'scan_planning', status: 'failed', reason: detail, requested_bounds: bounds };
		}
		await sendActionReport(input, report);
	}, [agentId, sessionId, scanResult, scanSpeedKnots, scanDataName, cooperation.fleet, missionAssignment, selectedMapObject, currentTaskId, sendWithCurrentScan, sendActionReport]);
	useEffect(() => {
		if (!pendingHomeMessage || pendingHomeMessage.sessionId !== sessionId || messagesLoading || homeMode) return;
		setPendingHomeMessage(null);
		void sendWithScanCoordinates(pendingHomeMessage.blocks).catch((error: unknown) =>
			setActionError(error instanceof Error ? error.message : '发送消息失败'),
		);
	}, [pendingHomeMessage, sessionId, messagesLoading, homeMode, sendWithScanCoordinates]);
	const sessionTitle = (view: typeof sessions[number]) => view.session.config.naming.auto
		? new Date(view.session.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
		: view.session.config.name;
	const visibleSessions = [...sessions]
		.sort((a, b) => new Date(b.session.updated_at).getTime() - new Date(a.session.updated_at).getTime())
		.filter((view) => sessionTitle(view).toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase()));
	const visibleProjects = agents.filter((agent) => agent.id !== quickChatAgent?.id && !isKnowledgeChatAgent(agent.data.name) && agent.data.name !== COLLABORATION_AGENT_NAME).sort((a, b) => Number(Boolean(pinnedProjects[b.id])) - Number(Boolean(pinnedProjects[a.id])));
	const openItemMenu = (item: SidebarItem, x: number, y: number) => {
		const doc = sidebarRef.current?.ownerDocument;
		const width = doc?.documentElement.clientWidth ?? 1200;
		const height = doc?.documentElement.clientHeight ?? 800;
		setContextMenu({ item, x: Math.max(8, Math.min(x, width - 230)), y: Math.max(8, Math.min(y, height - (item.kind === 'agent' ? 250 : 108))) });
		setSidebarNotice(null);
	};
	const handleItemContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, item: SidebarItem) => {
		event.preventDefault();
		openItemMenu(item, event.clientX, event.clientY);
	};
	const openItemDialog = (item: SidebarItem, action: SidebarDialog['action']) => {
		setContextMenu(null);
		setActionError(null);
		setSidebarDialog({ item, action });
		setSidebarDialogName(item.name);
	};
	const toggleProjectFlag = (kind: 'pin' | 'unread', id: string) => {
		const setter = kind === 'pin' ? setPinnedProjects : setUnreadProjects;
		setter((flags) => ({ ...flags, [id]: !flags[id] }));
		setContextMenu(null);
	};
	const copyItemLink = async (item: SidebarItem) => {
		const pathname = item.kind === 'agent' ? `/mission/${item.id}` : `/mission/${item.agentId}/${item.id}`;
		try {
			await navigator.clipboard.writeText(new URL(pathname, window.location.origin).href);
			setSidebarNotice('链接已复制');
		} catch {
			setSidebarNotice('复制失败，请检查浏览器剪贴板权限');
		}
		setContextMenu(null);
	};
	const handleItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, item: SidebarItem) => {
		const key = event.key.toLowerCase();
		if (event.key === 'ContextMenu' || (event.shiftKey && key === 'f10')) {
			event.preventDefault();
			const rect = event.currentTarget.getBoundingClientRect();
			openItemMenu(item, rect.right - 8, rect.bottom - 4);
		} else if (event.altKey && event.ctrlKey && key === 'r') {
			event.preventDefault();
			openItemDialog(item, 'rename');
		} else if (item.kind === 'agent' && event.altKey && event.ctrlKey && key === 'p') {
			event.preventDefault();
			toggleProjectFlag('pin', item.id);
		} else if (item.kind === 'agent' && event.ctrlKey && event.shiftKey && key === 'u') {
			event.preventDefault();
			toggleProjectFlag('unread', item.id);
		} else if (item.kind === 'agent' && event.ctrlKey && key === 'c') {
			event.preventDefault();
			void copyItemLink(item);
		} else if (key === 'delete') {
			event.preventDefault();
			openItemDialog(item, 'delete');
		}
	};
	const submitItemDialog = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!sidebarDialog || sidebarDialogBusy) return;
		const { item, action } = sidebarDialog;
		const name = sidebarDialogName.trim();
		if (action === 'rename' && !name) return;
		setSidebarDialogBusy(true);
		setActionError(null);
		try {
			if (action === 'rename') {
				if (item.kind === 'agent') await updateAgent(item.id, { name });
				else await updateSession(item.id, { name });
			} else if (item.kind === 'agent') {
				await removeAgent(item.id);
				if (item.id === agentId) navigate('/mission');
			} else {
				const next = sessions.find((view) => view.session.id !== item.id);
				await removeSession(item.id);
				if (item.id === sessionId) navigate(next ? `/mission/${agentId}/${next.session.id}` : `/mission/${agentId}`);
			}
			setSidebarDialog(null);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : '操作失败');
		} finally {
			setSidebarDialogBusy(false);
		}
	};
	const submitProjectDialog = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!projectName.trim() || sidebarDialogBusy) return;
		setSidebarDialogBusy(true);
		setActionError(null);
		try {
			const result = await createAgent({ name: projectName.trim(), ...(projectPrompt.trim() ? { system_prompt: projectPrompt.trim() } : {}) });
			setProjectDialogOpen(false);
			setProjectName('');
			setProjectPrompt('');
			setProjectsOpen(true);
			setActivePrimary('projects');
			navigate(`/mission/${result.agent_id}`);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : '创建项目失败');
		} finally {
			setSidebarDialogBusy(false);
		}
	};

	const handleModelChange = async (config: ChatModelConfig) => {
		if (!sessionId || isRunning || changingModel) return;
		setChangingModel(true);
		setActionError(null);
		try {
			await updateSession(sessionId, { chat_model_config: config });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : '切换模型失败');
			throw error;
		} finally {
			setChangingModel(false);
		}
	};

	const handleRenameAgent = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const name = agentNameDraft.trim();
		if (!agentId || !name || renamingAgent) return;
		setRenamingAgent(true);
		setActionError(null);
		try {
			await updateAgent(agentId, { name });
			setEditingAgentName(false);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : '重命名 Agent 失败');
		} finally {
			setRenamingAgent(false);
		}
	};

	const handleCreateSession = () => {
		setActivePrimary('ask');
		pendingImportSessionRef.current = null;
		if (!homeMode && activeSession?.session.config.chat_model_config) setHomeModelConfig(activeSession.session.config.chat_model_config);
		setHomeResetKey((value) => value + 1);
		setActionError(null);
		navigate('/mission');
	};

	const handleHomeSend = async (blocks: ContentBlock[]) => {
		if (creating) return;
		const model = homeSelectedModel;
		if (!model?.model) {
			setActionError('请先选择模型');
			return;
		}
		setCreating(true);
		setActionError(null);
		try {
			const targetAgentId = agentId ?? quickChatAgent?.id ?? (await createAgent({ name: QUICK_CHAT_NAME, system_prompt: QUICK_CHAT_PROMPT })).agent_id;
			const result = await createSession({ agent_id: targetAgentId, chat_model_config: model });
			setPendingHomeMessage({ sessionId: result.session_id, blocks });
			setResultHidden(true);
			navigate(`/mission/${targetAgentId}/${result.session_id}`);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : '创建会话失败');
		} finally {
			setCreating(false);
		}
	};

	const importScanData = async (file: File, data: ScanGeoJSON) => {
		if (creating) throw new Error('正在创建会话，请稍后重试。');
		if (agentId && sessionId) {
			const info = await missionScanApi.saveEnvironment(agentId, sessionId, file.name, data);
			setScanDataName(info.filename);
			setScanDataBounds(info.bounds);
			setScanResult(null);
			setResultHidden(false);
			return;
		}
		setCreating(true);
		try {
			// 海域数据按会话保存；尚无会话时先创建，再将文件绑定到新会话。
			let target = pendingImportSessionRef.current;
			if (!target || (agentId && target.agentId !== agentId)) {
				const targetAgentId = agentId ?? quickChatAgent?.id ?? (await createAgent({ name: QUICK_CHAT_NAME, system_prompt: QUICK_CHAT_PROMPT })).agent_id;
				const created = await createSession({ agent_id: targetAgentId, ...(homeSelectedModel ? { chat_model_config: homeSelectedModel } : {}) });
				target = { agentId: targetAgentId, sessionId: created.session_id };
				pendingImportSessionRef.current = target;
			}
			const info = await missionScanApi.saveEnvironment(target.agentId, target.sessionId, file.name, data);
			pendingImportSessionRef.current = null;
			setScanDataName(info.filename);
			setScanDataBounds(info.bounds);
			setScanResult(null);
			setResultHidden(false);
			navigate(`/mission/${target.agentId}/${target.sessionId}`);
		} finally {
			setCreating(false);
		}
	};

	const startMessageDeletion = (maxIndex: number, messageId: string) => {
		setMessageSelection({ maxIndex, ids: new Set([messageId]) });
		setDeleteSelectionError(null);
	};

	const toggleMessageSelection = (messageId: string) => {
		setMessageSelection((current) => {
			if (!current) return current;
			const ids = new Set(current.ids);
			if (ids.has(messageId)) ids.delete(messageId);
			else ids.add(messageId);
			return { ...current, ids };
		});
	};

	const confirmMessageDeletion = async () => {
		if (!messageSelection?.ids.size || deletingSelected) return;
		setDeletingSelected(true);
		setDeleteSelectionError(null);
		try {
			await deleteMessages([...messageSelection.ids]);
			setDeleteDialogOpen(false);
			setMessageSelection(null);
		} catch (error) {
			setDeleteSelectionError(error instanceof Error ? error.message : '删除失败，请重试。');
		} finally {
			setDeletingSelected(false);
		}
	};

	const resizeChatPanel = (requestedWidth: number) => {
		const workbench = workbenchRef.current;
		if (!workbench) return;
		const navWidth = workbench.querySelector('.mission-sidebars')?.getBoundingClientRect().width ?? 0;
		const minWidth = window.innerWidth >= 1251 ? 420 : 320;
		const resultMinWidth = window.innerWidth >= 1251 ? 420 : 320;
		const maxWidth = Math.max(minWidth, workbench.clientWidth - navWidth - resultMinWidth - 16);
		const width = Math.round(Math.min(maxWidth, Math.max(minWidth, requestedWidth)));
		setChatPanelWidth(width);
		localStorage.setItem('swarmbuddy.missionChatWidth', String(width));
	};

	const startPanelResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0 || !chatPanelRef.current) return;
		event.preventDefault();
		panelDrag.current = { pointerX: event.clientX, width: chatPanelRef.current.getBoundingClientRect().width };
		event.currentTarget.setPointerCapture(event.pointerId);
		setResizingPanels(true);
	};

	const movePanelResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (!panelDrag.current) return;
		resizeChatPanel(panelDrag.current.width + event.clientX - panelDrag.current.pointerX);
	};

	const stopPanelResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
		panelDrag.current = null;
		setResizingPanels(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
	};

	return (
		<div className="app-shell mission-live-ui">
			<header className="masthead">
				<h1>
					<span>SwarmBuddy</span>
				</h1>
				<SwarmAppRail />
				<div className="masthead-signature">
					<svg viewBox="0 0 140 22" aria-hidden="true">
						<path d="M1 16c25-12 45-12 65-3s43 6 72-9M18 16c20-9 44-5 68 0s28 2 42-3" />
					</svg>
					<span>深海无界 · 协同共行</span>
				</div>
			</header>
			<div
				ref={workbenchRef}
				className={`workbench ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${resultHidden ? 'result-hidden' : ''} ${credentialMode ? 'credential-mode' : ''} ${homeMode ? 'home-mode' : ''} ${chatPanelWidth !== null ? 'panel-resized' : ''} ${resizingPanels ? 'panels-resizing' : ''}`}
				style={chatPanelWidth === null ? undefined : { '--mission-chat-width': `${chatPanelWidth}px` } as CSSProperties}
			>
				<aside ref={sidebarRef} className="sidebar mission-sidebars" aria-label="侧边导航">
					{sidebarCollapsed && <button className="sidebar-toggle" type="button" aria-label="展开会话侧栏" aria-expanded={false} title="展开会话侧栏" onClick={() => setSidebarCollapsed(false)}><PanelLeftOpen size={18} /></button>}
					<div className="mission-history-sidebar" aria-label="项目与历史会话">
						<div className="mission-history-toolbar"><button className="sidebar-toggle" type="button" aria-label="收起会话侧栏" aria-expanded={true} data-tooltip="收起会话侧栏" onClick={() => setSidebarCollapsed(true)}><PanelLeftClose size={18} /></button></div>
						<nav className="nav-group mission-conversation-nav">
							<button className={`nav-item mission-primary-nav ${!credentialMode && activePrimary === 'ask' ? 'active' : ''}`} type="button" aria-label="新对话" disabled={creating} onClick={() => void handleCreateSession()}><MessageSquare className="icon" /><span>新对话</span><small>快速问答</small></button>
							<button className={`nav-item mission-primary-nav ${!credentialMode && activePrimary === 'projects' ? 'active' : ''}`} type="button" aria-label="我的项目" aria-expanded={projectsOpen} onClick={() => { setActivePrimary('projects'); setProjectsOpen((value) => !value); }}><FolderOpen className="icon" /><span>我的项目</span><small>创建任务</small></button>
							{projectsOpen && <div className="mission-project-list" aria-label="我的项目列表">
								{visibleProjects.map((agent) => {
									const item: SidebarItem = { kind: 'agent', id: agent.id, agentId: agent.id, name: agent.data.name };
									return <button key={agent.id} className={`${agent.id === agentId && !homeMode ? 'active' : ''} ${unreadProjects[agent.id] ? 'unread' : ''}`} type="button" title={`${agent.data.name} · 右键管理`} onClick={() => { setActivePrimary('projects'); setUnreadProjects((flags) => ({ ...flags, [agent.id]: false })); navigate(`/mission/${agent.id}`); }} onContextMenu={(event) => handleItemContextMenu(event, item)} onKeyDown={(event) => handleItemKeyDown(event, item)}><FolderOpen size={14} /><span>{agent.data.name}</span>{pinnedProjects[agent.id] && <Pin className="mission-project-pin" size={12} />}{unreadProjects[agent.id] && <i className="mission-project-unread" aria-label="未读" />}</button>;
								})}
								<button type="button" onClick={() => { setActionError(null); setProjectDialogOpen(true); }}><Plus size={14} /><span>新建项目</span></button>
							</div>}
						</nav>
						<div className="mission-history-heading"><button className="mission-history-toggle" type="button" aria-label={historyCollapsed ? '展开历史会话' : '折叠历史会话'} aria-expanded={!historyCollapsed} aria-controls="mission-history-list" onClick={() => setHistoryCollapsed((value) => !value)}><span>历史会话</span><ChevronRight className={historyCollapsed ? '' : 'expanded'} size={15} /></button><button type="button" aria-label={historySearchOpen ? '关闭历史会话搜索' : '搜索历史会话'} data-tooltip="搜索历史会话" onClick={() => { if (historyCollapsed) setHistoryCollapsed(false); setHistorySearchOpen((value) => !value); if (!historySearchOpen) window.setTimeout(() => historySearchRef.current?.focus(), 0); else setHistoryQuery(''); }}><Search size={18} /></button></div>
						{!historyCollapsed && historySearchOpen && <input ref={historySearchRef} className="mission-history-search" type="search" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索历史会话" aria-label="搜索历史会话" />}
						<div id="mission-history-list" className="mission-history-list" aria-label="历史会话列表" hidden={historyCollapsed}>
							{visibleSessions.map((view) => {
								const item: SidebarItem = { kind: 'session', id: view.session.id, agentId: view.session.agent_id, name: sessionTitle(view) };
								return <button key={view.session.id} className={`mission-history-item ${view.session.id === sessionId && !credentialMode && !homeMode ? 'active' : ''}`} type="button" title={`${sessionTitle(view)} · 右键管理`} aria-current={view.session.id === sessionId && !credentialMode && !homeMode ? 'page' : undefined} onClick={() => { setActivePrimary(view.session.agent_id === quickChatAgent?.id ? 'ask' : 'projects'); navigate(`/mission/${view.session.agent_id}/${view.session.id}`); }} onContextMenu={(event) => handleItemContextMenu(event, item)} onKeyDown={(event) => handleItemKeyDown(event, item)}><MessageSquare size={16} /><span>{sessionTitle(view)}</span></button>;
							})}
							{visibleSessions.length === 0 && <p className="mission-history-empty">{historyQuery ? '没有找到匹配的会话' : '还没有历史会话'}</p>}
							{sidebarNotice && <p className="mission-sidebar-notice" role="status">{sidebarNotice}</p>}
							<p className="mission-history-note">为你保留最近90天历史记录</p>
						</div>
					</div>
				</aside>
				{credentialMode && <CredentialWorkspace key={`${agentId}:${sessionId}`} agentId={agentId} sessionId={sessionId} />}
				{homeMode && <main className="mission-home-main" aria-label="SwarmBuddy 主页">
					<div className="mission-home-brand"><img src="/ocean/assets/h-theme/branding/mark.svg" alt="" /><h2>SwarmBuddy</h2></div>
					<div className="mission-home-input">
						{actionError && <p className="mission-home-error" role="alert">{actionError}</p>}
						<MissionComposer key={`home:${homeResetKey}`} homeMode canSend={Boolean(homeSelectedModel?.model && !creating)} isRunning={false} phase="idle" modelType={homeSelectedModel?.type} credentialId={homeSelectedModel?.credential_id} modelName={homeSelectedModel?.model} modelParameters={homeSelectedModel?.parameters} changingModel={creating} onModelChange={async (config) => { setHomeModelConfig(config); }} onConfigureModels={() => navigate(sessionId ? `/mission/${agentId}/${sessionId}?view=credential` : agentId ? `/mission/${agentId}?view=credential` : '/mission?view=credential')} onSend={handleHomeSend} onInterrupt={async () => {}} onImportScanData={importScanData} scanDataName={scanDataName} scanDataBounds={scanDataBounds} placeholder="有问题尽管问SwarmBuddy…" />
					</div>
					<a className="mission-home-photo-credit" href="https://www.nature.com/articles/d42473-022-00140-y" target="_blank" rel="noopener noreferrer">精海无人艇实拍 · 上海大学 / Nature</a>
				</main>}
				<main ref={chatPanelRef} className="agent-panel panel" aria-label="Agent 执行过程">
					<div className="coordinator-heading">
						<RobotAvatar />
						<div className="coordinator-identity">
							{editingAgentName ? (
								<form className="coordinator-rename" onSubmit={(event) => void handleRenameAgent(event)}>
									<input
										aria-label="Agent 名称"
										value={agentNameDraft}
										onChange={(event) => setAgentNameDraft(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === 'Escape') setEditingAgentName(false);
										}}
										maxLength={50}
										autoFocus
									/>
									<button type="submit" aria-label="保存名称" disabled={!agentNameDraft.trim() || renamingAgent}><Check size={17} /></button>
									<button type="button" aria-label="取消重命名" onClick={() => setEditingAgentName(false)} disabled={renamingAgent}><X size={17} /></button>
								</form>
							) : (
								<div className="coordinator-title">
									<h2>{activeAgent?.data.name ?? '任务协调员'}</h2>
									{activeAgent && (
										<button
											type="button"
											aria-label="重命名当前 Agent"
											data-tooltip="重命名 Agent"
											onClick={() => {
												setAgentNameDraft(activeAgent.data.name);
												setEditingAgentName(true);
											}}
										><Pencil size={15} /></button>
									)}
								</div>
							)}
						<p>{sessionId ? currentModel ? `当前模型：${currentModel}` : '当前模型：未配置' : homeSelectedModel?.model ? `当前模型：${homeSelectedModel.model}` : '当前模型：未配置'}</p>
						</div>
						{resultHidden && (
							<button className="icon-button result-restore" type="button" aria-label="展开" data-tooltip="展开" onClick={() => setResultHidden(false)}>
								<PanelRightOpen className="icon" />
							</button>
						)}
					</div>
					<div className="conversation-flow" ref={conversationRef} aria-live="polite" onScroll={handleConversationScroll} onWheel={(event) => { if (event.deltaY < 0) { jumpingToLatestRef.current = false; followConversationRef.current = false; setShowLatestButton(true); } }}>
						{agentsError && (
							<div className="mission-notice">
								Agent 加载失败：{agentsError.message}
							</div>
						)}
						{sessionsError && <div className="mission-notice">会话加载失败：{sessionsError.message}</div>}
						{actionError && <div className="mission-notice">操作失败：{actionError}</div>}
						{messageError && (
							<div className="mission-notice">会话出错：{messageError.message}</div>
						)}
						{activeSession && !hasModel && (
							<div className="mission-notice">
								当前会话尚未配置模型，请在下方选择模型。
								<button
									type="button"
									onClick={() => navigate(`/mission/${agentId}/${sessionId}?view=credential`)}
								>
									管理凭证
								</button>
							</div>
						)}
						{messagesLoading && <div className="mission-empty">正在读取会话…</div>}
						{activeSession && !messagesLoading && displayMsgs.length === 0 && (
							<div className="mission-empty-suggestions">
								<ul>
									<li>输入海域边界经纬度，生成扫描结果</li>
									<li>输入起点和终点坐标，生成扫描航线</li>
									<li>点击右侧“分析当前方案”，分析扫描结果</li>
								</ul>
							</div>
						)}
						{displayMsgs.map((message, index) => {
							const text = messageText(message);
							const previousUser = previousUserById.get(message.id);
							const messageTime = new Date(message.created_at).getTime();
							const previousUserTime = previousUser ? new Date(previousUser.created_at).getTime() : NaN;
							const showTimeDivider = message.role === 'user' && Number.isFinite(messageTime) && (!previousUser || !Number.isFinite(previousUserTime) || !isSameMissionDay(messageTime, previousUserTime) || messageTime - previousUserTime >= 10 * 60 * 1000);
							const clock = formatMissionClock(message.created_at);
							const fullTime = formatMissionDateTime(message.created_at);
							const replyDuration = message.role === 'assistant' && message.finished_at ? formatMissionDuration(message.created_at, message.finished_at) : null;
							const hasThinking = message.content.some((block) => block.type === 'thinking');
							const replyError = message.finished_reason === ReplyFinishedReason.ERROR
								? message.error?.message ?? '模型调用失败，请重试。'
								: null;
							const hasVisibleReply = message.content.some((block) => block.type === 'text' || block.type === 'thinking' || block.type === 'data');
							const replyIsActive = isRunning && message.id === lastAssistant?.id;
							const pendingEmptyReply = replyIsActive && !replyError && !message.finished_at && message.content.length === 0;
							const renderedMessage = message.role === 'user' ? (
								<div className="user-message">
									<MissionMessageContent content={message.content.filter((block) => !isScanContextBlock(block))} fallback="已发送附件" attachmentsFirst />
									{!messageSelection && <div className="mission-user-footer">
										<MissionUserMessageActions text={text} canDelete={!isRunning} onQuote={() => setQuotedMessage(text.slice(0, 600))} onDelete={() => startMessageDeletion(msgs.findIndex((item) => item.id === message.id), message.id)} />
										{clock && <time className="mission-message-clock" dateTime={message.created_at} title={fullTime}>{clock}</time>}
									</div>}
								</div>
							) : (
								<MissionReplyFrame
									startedAt={message.created_at}
									duration={hasThinking ? null : replyDuration}
									actions={!messageSelection && message.finished_at && <MissionMessageActions
										messageId={message.id}
										text={text}
										canRegenerate={Boolean(previousUser && canSend)}
										onRegenerate={() => previousUser ? send(previousUser.content) : Promise.resolve()}
									/>}
								>
									<MissionReplyOverview
										content={message.content}
										userContent={previousUser?.content}
										finished={!replyIsActive}
										onOpenAnalysis={scanResult ? onOpenReplyAnalysis : undefined}
									/>
									{pendingEmptyReply && <MissionThinkingIndicator stopping={phase === 'interrupting'} startedAt={message.created_at} />}
									{(hasVisibleReply || (message.finished_at && !replyError)) && <div className="understanding">
										<MissionMessageContent content={message.content} fallback="本次没有生成文字回复，请重试。" streaming={!message.finished_at} pace={liveReplyIds.has(message.id)} replyFinishedAt={message.finished_at} revealKeyPrefix={sessionId + ':' + message.id} />
									</div>}
									{replyError && <div className="mission-reply-error" role="alert"><strong>回复失败</strong><span>{replyError}</span></div>}
									<MissionToolCalls content={message.content} replyId={message.id} onUserConfirm={onUserConfirm} />
								</MissionReplyFrame>
							);
							return <Fragment key={message.id}>
								{showTimeDivider && <div className="mission-time-divider"><time dateTime={message.created_at} title={fullTime}>{formatMissionDividerTime(message.created_at)}</time></div>}
								{messageSelection && msgs.findIndex((item) => item.id === message.id) <= messageSelection.maxIndex ? (
									<div className="mission-selectable-message">
										<label className="mission-message-checkbox"><input type="checkbox" aria-label={`选择第 ${index + 1} 条消息`} checked={messageSelection.ids.has(message.id)} onChange={() => toggleMessageSelection(message.id)} /></label>
										{renderedMessage}
									</div>
								) : renderedMessage}
							</Fragment>;
						})}
						{activeSession && isRunning && !lastAssistant && <MissionReplyFrame startedAt={msgs[lastUserIndex]?.created_at}>
							<MissionThinkingIndicator stopping={phase === 'interrupting'} startedAt={msgs[lastUserIndex]?.created_at} />
						</MissionReplyFrame>}
					</div>
					{showLatestButton && <button className="mission-jump-latest" type="button" onClick={scrollToLatest}><ArrowDown size={15} /> 回到最新消息</button>}
					{messageSelection && <div className="mission-selection-bar">
						<span>已选择 {messageSelection.ids.size} 条消息</span>
						<button type="button" onClick={() => setMessageSelection(null)}>取消</button>
						<button className="danger" type="button" disabled={messageSelection.ids.size === 0} onClick={() => setDeleteDialogOpen(true)}>删除所选</button>
					</div>}
					<MissionComposer
						key={`${agentId ?? ''}:${sessionId ?? ''}`}
							quote={quotedMessage}
							onClearQuote={() => setQuotedMessage(null)}
							selectedMapObject={selectedMapObject?.mission_id === currentTaskId ? `${selectedMapObject.kind.toUpperCase()} · ${selectedMapObject.id}` : null}
							onClearMapObject={() => setSelectedMapObject(null)}
						canSend={canSend}
						isRunning={Boolean(sessionId && isRunning)}
						phase={sessionId ? phase : 'idle'}
						modelType={sessionId ? activeSession?.session.config.chat_model_config?.type : homeSelectedModel?.type}
						credentialId={sessionId ? activeSession?.session.config.chat_model_config?.credential_id : homeSelectedModel?.credential_id}
						modelName={sessionId ? currentModel : homeSelectedModel?.model}
						modelParameters={sessionId ? activeSession?.session.config.chat_model_config?.parameters : homeSelectedModel?.parameters}
						changingModel={sessionId ? changingModel : creating}
						onModelChange={sessionId ? handleModelChange : async (config) => { setHomeModelConfig(config); }}
						onConfigureModels={() => navigate(sessionId ? `/mission/${agentId}/${sessionId}?view=credential` : agentId ? `/mission/${agentId}?view=credential` : '/mission?view=credential')}
						onSend={sessionId ? sendWithScanCoordinates : handleHomeSend}
						onInterrupt={interrupt}
						onImportScanData={importScanData}
						scanDataName={scanDataName}
						scanDataBounds={scanDataBounds}
					/>
				</main>
				<section
					className={`result-panel panel ${expanded ? 'expanded' : ''}`}
					aria-label="海域扫描结果"
				>
					{!expanded && <button className="mission-panel-resizer" type="button" aria-label="拖动调整聊天栏和海域扫描结果栏的宽度" title="拖动调整两栏宽度" onPointerDown={startPanelResize} onPointerMove={movePanelResize} onPointerUp={stopPanelResize} onPointerCancel={stopPanelResize} onKeyDown={(event) => {
						if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
							event.preventDefault();
							resizeChatPanel((chatPanelRef.current?.getBoundingClientRect().width ?? 500) + (event.key === 'ArrowRight' ? 24 : -24));
						}
					}}><span aria-hidden="true" /></button>}
					<div className="mission-situation-topbar">
						<div className="mission-situation-tabs" role="tablist" aria-label="态势看板栏目">
							{SITUATION_TABS.map(({ id, label }, index) => (
								<button
									key={id}
									id={'mission-tab-' + id}
									type="button"
									role="tab"
									aria-label={label}
									aria-controls="mission-situation-tabpanel"
									aria-selected={situationTab === id}
									tabIndex={situationTab === id ? 0 : -1}
									className={situationTab === id ? 'active' : ''}
									onClick={() => setSituationTab(id)}
									onKeyDown={(event) => handleSituationTabKeys(event, index)}
								>{label}</button>
							))}
						</div>
						<div className="mission-situation-environment" aria-label="海域天气" title={marineObservations?.station ? `NOAA NDBC 浮标 ${marineObservations.station.id}｜距航迹 ${marineObservations.station.distance_km} km｜观测时间 ${marineObservations.observed_at}` : marineObservations?.sample ? `${marineObservations.sample_kind === 'demo' ? '示例航迹坐标｜' : ''}预海天气｜坐标 [${marineObservations.sample.longitude}, ${marineObservations.sample.latitude}]｜天气实况 ${marineObservations.observed_at ?? '时间未知'}` : marineObservations?.message ?? '根据当前航迹查询海域天气'}><div className="mission-situation-environment-time"><MissionSituationClock /><span>{observationState === 'ready' ? marineObservations?.source === '预海天气' ? '天气实况' : '浮标实测' : observationState === 'loading' ? '查询海况中' : observationState === 'unavailable' ? '暂无海况' : observationState === 'error' ? '海况服务异常' : '待查询海况'}</span></div><div className="mission-situation-environment-values"><span>温度：{marineObservations?.temperature_c == null ? '—' : `${marineObservations.temperature_c.toFixed(1)} ℃`}</span><span>能见度：{marineObservations?.visibility_km == null ? '—' : `${marineObservations.visibility_km.toFixed(1)} km`}</span><span>风速：{marineObservations?.wind_speed_ms == null ? '—' : `${marineObservations.wind_speed_ms.toFixed(1)} m/s`}</span></div></div>
					</div>
					<header className="result-heading mission-situation-taskbar">
						<div className="mission-situation-task-title"><span className="mission-situation-task-icon"><SituationIcon size={16} aria-hidden="true" /></span><strong>{situationTitle}</strong></div>
						<div className="map-controls">
							{situationTab === 'overview' && <MissionScanPlanner agentId={agentId} sessionId={sessionId} result={scanResult} coordinatePrefill={coordinatePrefill} importedBounds={scanDataBounds} onSpeedChange={(speed) => { saveScanSpeed(agentId, sessionId, speed); setScanSpeedKnots(speed); }} onResult={(next) => { setScanResult(next); setMapMode('route'); if (next.source === 'demo') setScanDataName(null); }} />}
							{situationTab === 'analysis' && <><button className="mission-scan-analyze" type="button" disabled={!canAnalyzeScan} title={!scanResult ? '请先生成航迹' : !hasModel ? '请先选择聊天模型' : isRunning ? '请等待当前回复完成' : '让当前模型分析右侧方案'} onClick={() => void analyzeScan()}><Sparkles size={15} aria-hidden="true" /><span>{startingScanAnalysis ? '正在发起…' : '分析当前方案'}</span></button><MissionScanDownloadSave result={scanResult} speedKnots={scanSpeedKnots} agentId={agentId} sessionId={sessionId} mapFrameRef={mapFrameRef} /></>}
							{situationTab === 'overview' && <>
								<select className="mission-map-layer-select" aria-label="地图显示模式" value={mapMode} onChange={(event) => setMapMode(event.target.value as 'route' | 'terrain')}>
									<option value="route">航迹视觉示意</option>
									<option value="terrain">只看岛屿</option>
								</select>
								<button type="button" className={`mission-multigrid-button ${multiGridEnabled ? 'active' : ''}`} aria-label={multiGridEnabled ? '关闭 MultiGrid 网格试验' : '开启 MultiGrid 网格试验'} aria-pressed={multiGridEnabled} title="记录多艇经过网格的时间；这不是传感器探测覆盖率" disabled={!scanResult} onClick={() => { setMultiGrid(multiGridInitial(cooperation.second)); setMultiGridEnabled((value) => !value); }}><Grid3X3 size={14} /><span>网格试验</span></button>
							</>}
							<button
								className="icon-button"
								type="button"
								aria-label="收起"
								data-tooltip="收起"
								onClick={() => { setExpanded(false); setResultHidden(true); }}
							>
								<PanelRightClose className="icon" />
							</button>
							<button
								className="icon-button"
								type="button"
								aria-label={expanded ? '退出看板全屏' : '全屏显示看板'}
								data-tooltip={expanded ? '退出看板全屏' : '全屏显示看板'}
								onClick={() => setExpanded(!expanded)}
							>
								<Expand className="icon" />
							</button>
						</div>
					</header>
					<div
						id="mission-situation-tabpanel"
						className="mission-situation-tabpanel"
						role="tabpanel"
						aria-labelledby={'mission-tab-' + situationTab}
						data-view={situationTab}
						tabIndex={0}
					>
						{situationTab === 'execution' && <MissionExecutionPanel
							result={scanResult}
							cooperation={cooperation}
							assignmentReady={Boolean(missionAssignment)}
							error={taskEventError}
							onToggle={toggleMissionSimulation}
							onOpenOverview={() => openSituationOverview(Boolean(scanResult))}
						/>}
						{situationTab === 'analysis' && <MissionAnalysisPanel
							result={scanResult}
							speedKnots={scanSpeedKnots}
							onOpenOverview={() => openSituationOverview()}
						/>}
						{situationTab === 'targets' && <MissionTargetsPanel
							key={currentTaskId ?? sessionId}
							result={scanResult}
							cooperation={cooperation}
							onLocate={locateDashboardTarget}
						/>}
						{situationTab === 'game' && <MissionGamePanel result={scanResult} />}
						{(situationTab === 'overview' || (situationTab === 'analysis' && scanResult)) && <>
							{situationTab === 'analysis' && <h3 className="mission-dashboard-map-title"><Route size={16} aria-hidden="true" />航迹预览</h3>}
							<div className={expanded && situationTab === 'overview' ? 'mission-situation-body with-aside' : 'mission-situation-body'}>
					<div ref={mapFrameRef} className={`map-frame ${mapMode === 'terrain' ? 'terrain-only' : ''}`}>
						{scanResult ? <MissionScanMap result={scanResult} conditions={marineConditions} cooperation={cooperation} multiGrid={multiGridEnabled ? multiGrid : null} selectedUsvId={selectedUsvId} onSelectUsv={setSelectedUsvId} selectedMapObject={selectedMapObject?.mission_id === currentTaskId ? selectedMapObject : null} onSelectMapObject={(kind, id) => { if (currentTaskId) setSelectedMapObject({ kind, id, mission_id: currentTaskId }); }} targetSelected={targetSelected} onSelectTarget={focusTrainingTarget} targetFocusToken={targetFocusToken} focusPoint={observationFocusPoint} manualTargetUavId={manualTargetUavId} onManualTargetPoint={(target) => { const drone = cooperation.fleet?.drones.find((item) => item.id === manualTargetUavId); if (!drone || !missionAssignment) return; setTaskEventBusy(true); void postTaskEvent(drone.id, 'UAV_TARGET_REQUESTED', drone.position, { target_position: target }).then((event) => { if (event.status === 'completed') { setCooperation((current) => current.fleet ? { ...current, fleet: commandFleetUav(current.fleet, drone.id, 'manual', current.second, { target }) } : current); setManualTargetUavId(null); } }).catch(taskFailure).finally(() => setTaskEventBusy(false)); }} onCancelManualTarget={() => setManualTargetUavId(null)} onClearManualTarget={(id) => commandMissionUav(id, 'hover')} /> : <img
							className="ocean-terrain"
							src="/ocean/assets/h-theme/maps/deep-sea-terrain.png"
							alt="岩岛与深海海浪组成的示意海域"
					/>}
						{!scanResult && <svg
							className="map-overlay"
							viewBox="0 0 1000 625"
							preserveAspectRatio="none"
							aria-label="设计稿中的示意航迹"
						>
							<defs>
								<filter id="routeGlow" x="-25%" y="-25%" width="150%" height="150%">
									<feGaussianBlur stdDeviation="3" result="blur" />
									<feMerge>
										<feMergeNode in="blur" />
										<feMergeNode in="SourceGraphic" />
									</feMerge>
								</filter>
							</defs>
							<path
								className="mission-boundary"
								d="M184 35H620L650 74H744L794 160 842 210 856 377 759 489 747 590H132L72 390 86 198Z"
							/>
							<g className="island-boundaries">
								<path d="M215 86Q245 76 255 114L275 150 259 198 214 198 186 157 194 119Z" />
								<path d="M351 275 389 224 441 214 476 159 527 194 568 263 547 340 568 382 525 431 476 444 436 412 374 402 347 352Z" />
								<path d="M636 230 660 231 693 276 660 309 609 312 606 274Z" />
								<path d="M665 434 708 436 752 491 731 542 674 560 619 537 619 490Z" />
							</g>
							<g className="scan-routes" filter="url(#routeGlow)">
								<path
									className="scan-path"
									d={DEMO_BOAT_ROUTE}
								/>
								<path
									className="scan-path"
									d="M328 225H160Q136 225 136 241Q136 257 160 257H302Q326 257 326 273Q326 289 302 289H142Q118 289 118 305Q118 321 142 321H290Q314 321 314 337Q314 353 290 353H133Q109 353 109 369Q109 385 133 385H314Q338 385 338 401Q338 417 314 417H155Q131 417 131 433Q131 449 155 449H381"
								/>
								<path
									className="scan-path"
									d="M609 203H791Q815 203 815 219Q815 235 791 235H727Q711 235 711 251Q711 267 727 267H750Q766 267 766 283Q766 299 750 299H737Q721 299 721 315Q721 331 737 331H765Q781 363 765 363H655Q631 363 631 379Q631 395 655 395H774Q798 395 798 411Q798 427 774 427H618"
								/>
								<path
									className="scan-path"
									d="M449 473H172Q148 473 148 489Q148 505 172 505H474Q498 505 498 521Q498 537 474 537H192Q168 537 168 553Q168 569 192 569H463"
								/>
							</g>
						</svg>}
						<div className="map-vignette" />
						{multiGridEnabled && <div className="mission-multigrid-stats" aria-label="MultiGrid 网格访问试验统计"><strong>MultiGrid · 仿真访问</strong><span>已访问 {multiGridStats.visitedCells} 格</span><span>多艇重叠 {multiGridStats.sharedCells} 格</span><small>累计艇时 {multiGridStats.vesselSeconds.toFixed(1)} 秒 · 非探测覆盖率</small></div>}
						<div className={`mission-situation-map-progress ${progressCollapsed ? 'is-collapsed' : ''}`} aria-label="扫描规划与仿真进度">
							<div className="mission-progress-head"><strong>{cooperation.fleet?.assigned || cooperation.second ? '任务进度' : '扫描规划'}</strong><b>{scanResult ? cooperation.fleet?.assigned || cooperation.second ? `${simulatedCoverage(cooperation)}%` : '已生成' : '待规划'}</b><button type="button" className="mission-overlay-toggle" aria-label={progressCollapsed ? '展开任务进度面板' : '折叠任务进度面板'} aria-expanded={!progressCollapsed} onClick={() => setProgressCollapsed((value) => !value)}><ChevronRight size={14} /></button></div>
							{scanResult && !progressCollapsed && <>
								<div className="mission-progress-track"><i style={{ width: `${cooperation.fleet?.assigned || cooperation.second ? simulatedCoverage(cooperation) : Math.min(100, Math.max(0, scanResult.planned_coverage_percent))}%` }} /></div>
								<dl>{cooperation.fleet?.assigned ? <>
									<div><dt><ScanLine size={12} />航迹执行</dt><dd>{simulatedCoverage(cooperation)}%</dd></div>
									<div><dt><UavIcon width={12} height={12} />空中无人机</dt><dd>{cooperation.fleet.drones.filter((drone) => drone.mode !== 'deck').length} 架</dd></div>
									<div><dt><UsvIcon width={12} height={12} />执行无人艇</dt><dd>{cooperation.fleet.boats.filter((boat) => boat.route.length).length} 艘</dd></div>
								</> : cooperation.second ? <>
									<div><dt><ScanLine size={12} />航迹执行</dt><dd>{simulatedCoverage(cooperation)}%</dd></div>
									<div><dt><UavIcon width={12} height={12} />UAV 分区</dt><dd>{Math.round(cooperation.uavProgress * 100)}%</dd></div>
									<div><dt><UsvIcon width={12} height={12} />USV 分区</dt><dd>{Math.round(cooperation.usvProgress * 100)}%</dd></div>
								</> : <>
									<div><dt><ScanLine size={12} />规划覆盖率</dt><dd>{scanResult.planned_coverage_percent.toFixed(1)}%</dd></div>
									<div><dt><TriangleAlert size={12} />岛礁与障碍物</dt><dd>{scanResult.obstacle_count}</dd></div>
									<div><dt><CircleDot size={12} />规划航点</dt><dd>{scanResult.waypoint_count}</dd></div>
									<div><dt><Route size={12} />规划航程</dt><dd>{(scanResult.path_length_m / 1000).toFixed(1)} km</dd></div>
								</>}</dl>
							</>}
						</div>
						<div className={`map-legend mission-situation-legend ${legendCollapsed ? 'is-collapsed' : ''}`} aria-label="海域扫描地图图例">
							<button type="button" className="mission-overlay-toggle mission-legend-toggle" aria-label={legendCollapsed ? '展开地图图例' : '折叠地图图例'} title={legendCollapsed ? '展开图例' : '折叠图例'} aria-expanded={!legendCollapsed} onClick={() => setLegendCollapsed((value) => !value)}><ChevronRight size={13} /></button>
							{!legendCollapsed && (mapMode === 'route' ? <>
								<span><UavIcon className="mission-legend-uav" width={16} height={16} />无人机（UAV）</span>
								<span><i className="mission-legend-target" aria-hidden="true" />目标位置</span>
								<span><UsvIcon className="mission-legend-usv" width={16} height={16} />无人艇（USV）</span>
								<span><i className="mission-legend-risk" aria-hidden="true" />高风险区域</span>
								<span><Radar className="mission-legend-radar" size={16} />雷达覆盖</span>
								<span><i className="mission-legend-search" aria-hidden="true" />规划边界</span>
							</> : <span><Compass size={16} />卫星岛屿</span>)}
						</div>
						{scanResult && <details className="mission-satellite-credit"><summary>影像来源</summary><span>EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)</span></details>}
					</div>
						{expanded && situationTab === 'overview' && <MissionSituationAside result={scanResult} cooperation={cooperation} onChange={setCooperation} selectedUsvId={selectedUsvId} onSelectUsv={setSelectedUsvId} onSelectAsset={(kind, id) => { if (currentTaskId) setSelectedMapObject({ kind, id, mission_id: currentTaskId }); }} targetSelected={targetSelected} onSelectTarget={focusTrainingTarget} onFocusObservation={focusObservation} manualTargetUavId={manualTargetUavId} onArmManualTarget={setManualTargetUavId} taskAssignment={missionAssignment} taskEvents={taskEvents} taskEventError={taskEventError} taskEventBusy={taskEventBusy} onReleaseUav={releaseMissionUav} onReportTarget={reportMissionTarget} onRespondObservation={respondMissionObservation} onCommandUav={commandMissionUav} onToggleSimulation={toggleMissionSimulation} />}
					</div>
							{situationTab === 'overview' && <MissionScanSummary result={scanResult} speedKnots={scanSpeedKnots} portalDocument={frameDocument} cooperation={cooperation} />}
						</>}
					</div>
				</section>
			</div>
			{contextMenu && frameDocument && createPortal(
				<div ref={contextMenuRef} className="mission-item-context-menu" role="menu" aria-label={`${contextMenu.item.name} 操作`} style={{ left: contextMenu.x, top: contextMenu.y }} onKeyDown={(event) => {
					const item = contextMenu.item;
					const key = event.key.toLowerCase();
					if (event.altKey && event.ctrlKey && key === 'r') { event.preventDefault(); openItemDialog(item, 'rename'); }
					else if (item.kind === 'agent' && event.altKey && event.ctrlKey && key === 'p') { event.preventDefault(); toggleProjectFlag('pin', item.id); }
					else if (item.kind === 'agent' && event.ctrlKey && event.shiftKey && key === 'u') { event.preventDefault(); toggleProjectFlag('unread', item.id); }
					else if (item.kind === 'agent' && event.ctrlKey && key === 'c') { event.preventDefault(); void copyItemLink(item); }
					else if (key === 'delete') { event.preventDefault(); openItemDialog(item, 'delete'); }
				}}>
					<button type="button" role="menuitem" onClick={() => openItemDialog(contextMenu.item, 'rename')}><Pencil size={16} /><span>重命名</span><kbd>Alt+Ctrl+R</kbd></button>
					{contextMenu.item.kind === 'agent' && <>
						<button type="button" role="menuitem" onClick={() => toggleProjectFlag('pin', contextMenu.item.id)}>{pinnedProjects[contextMenu.item.id] ? <PinOff size={16} /> : <Pin size={16} />}<span>{pinnedProjects[contextMenu.item.id] ? '取消置顶' : '置顶'}</span><kbd>Alt+Ctrl+P</kbd></button>
						<button type="button" role="menuitem" onClick={() => toggleProjectFlag('unread', contextMenu.item.id)}>{unreadProjects[contextMenu.item.id] ? <Eye size={16} /> : <EyeOff size={16} />}<span>{unreadProjects[contextMenu.item.id] ? '标记已读' : '标记未读'}</span><kbd>Ctrl+Shift+U</kbd></button>
						<button type="button" role="menuitem" title="复制项目链接" onClick={() => void copyItemLink(contextMenu.item)}><Copy size={16} /><span>复制</span><kbd>Ctrl+C</kbd></button>
					</>}
					<div className="mission-item-menu-divider" role="separator" />
					<button className="danger" type="button" role="menuitem" onClick={() => openItemDialog(contextMenu.item, 'delete')}><Trash2 size={16} /><span>删除</span><kbd>Delete</kbd></button>
				</div>,
				frameDocument.body,
			)}
			{sidebarDialog && frameDocument && createPortal(
				<div className="mission-item-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !sidebarDialogBusy) setSidebarDialog(null); }}>
					<form className="mission-item-dialog" role="dialog" aria-modal="true" aria-labelledby="missionItemDialogTitle" onSubmit={(event) => void submitItemDialog(event)} onKeyDown={(event) => { if (event.key === 'Escape' && !sidebarDialogBusy) setSidebarDialog(null); }}>
						<h2 id="missionItemDialogTitle">{sidebarDialog.action === 'rename' ? `重命名${sidebarDialog.item.kind === 'agent' ? '项目' : '历史会话'}` : `删除${sidebarDialog.item.kind === 'agent' ? '项目' : '历史会话'}`}</h2>
						{sidebarDialog.action === 'rename' ? <input ref={sidebarDialogInputRef} value={sidebarDialogName} onChange={(event) => setSidebarDialogName(event.target.value)} maxLength={80} aria-label="新名称" /> : <p>确定删除“{sidebarDialog.item.name}”？删除后无法恢复。</p>}
						{actionError && <p className="mission-item-dialog-error" role="alert">{actionError}</p>}
						<div className="mission-item-dialog-actions"><button type="button" onClick={() => setSidebarDialog(null)} disabled={sidebarDialogBusy}>取消</button><button className={sidebarDialog.action === 'delete' ? 'danger' : 'primary'} type="submit" disabled={sidebarDialogBusy || (sidebarDialog.action === 'rename' && !sidebarDialogName.trim())}>{sidebarDialogBusy ? '处理中…' : sidebarDialog.action === 'delete' ? '删除' : '保存'}</button></div>
					</form>
				</div>,
				frameDocument.body,
			)}
			{deleteDialogOpen && messageSelection && frameDocument && createPortal(
				<div className="mission-delete-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !deletingSelected) setDeleteDialogOpen(false); }}>
					<div className="mission-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="missionDeleteDialogTitle" onKeyDown={(event) => { if (event.key === 'Escape' && !deletingSelected) setDeleteDialogOpen(false); }}>
						<button className="mission-delete-dialog-close" type="button" aria-label="关闭" disabled={deletingSelected} onClick={() => setDeleteDialogOpen(false)}><X size={18} /></button>
						<h2 id="missionDeleteDialogTitle"><TriangleAlert size={21} />删除所选消息？</h2>
						<p>将从聊天记录中删除选中的 {messageSelection.ids.size} 条消息及随消息保存的附件，无法恢复。</p>
						{deleteSelectionError && <p className="mission-delete-dialog-error" role="alert">{deleteSelectionError}</p>}
						<div className="mission-delete-dialog-actions"><button type="button" autoFocus disabled={deletingSelected} onClick={() => setDeleteDialogOpen(false)}>取消</button><button className="danger" type="button" disabled={deletingSelected} onClick={() => void confirmMessageDeletion()}>{deletingSelected ? '删除中…' : '删除'}</button></div>
					</div>
				</div>,
				frameDocument.body,
			)}
			{projectDialogOpen && frameDocument && createPortal(
				<div className="mission-item-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !sidebarDialogBusy) setProjectDialogOpen(false); }}>
					<form className="mission-item-dialog" role="dialog" aria-modal="true" aria-labelledby="missionProjectDialogTitle" onSubmit={(event) => void submitProjectDialog(event)} onKeyDown={(event) => { if (event.key === 'Escape' && !sidebarDialogBusy) setProjectDialogOpen(false); }}>
						<h2 id="missionProjectDialogTitle">新建项目</h2>
						<label className="mission-dialog-label" htmlFor="missionProjectName">名称</label>
						<input id="missionProjectName" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={80} autoFocus required />
						<label className="mission-dialog-label" htmlFor="missionProjectPrompt">项目描述（可选）</label>
						<textarea id="missionProjectPrompt" value={projectPrompt} onChange={(event) => setProjectPrompt(event.target.value)} rows={4} placeholder="简述项目内容与用途" />
						{actionError && <p className="mission-item-dialog-error" role="alert">{actionError}</p>}
						<div className="mission-item-dialog-actions"><button type="button" onClick={() => setProjectDialogOpen(false)} disabled={sidebarDialogBusy}>取消</button><button className="primary" type="submit" disabled={sidebarDialogBusy || !projectName.trim()}>{sidebarDialogBusy ? '创建中…' : '创建'}</button></div>
					</form>
				</div>,
				frameDocument.body,
			)}
		</div>
	);
}

export function MissionPage() {
	const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
	return (
		<>
			<iframe
				className="mission-frame"
				title="SwarmBuddy 聊天"
				allow="display-capture; microphone; autoplay"
				srcDoc={FRAME_HTML}
				onLoad={(event) =>
					setPortalRoot(
						event.currentTarget.contentDocument?.getElementById('mission-root') ?? null,
					)
				}
				style={{ border: 0, width: '100%', height: '100vh', display: 'block', background: '#0b1013' }}
			/>
			{portalRoot &&
				createPortal(
					<AudioProvider>
						<MissionContent />
					</AudioProvider>,
					portalRoot,
				)}
		</>
	);
}
