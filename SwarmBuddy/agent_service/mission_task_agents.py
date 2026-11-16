"""Event-driven, simulated USV/UAV task agents on AgentScope's message bus.

The browser owns kinematics. This service owns mission identities, event
delivery, validation and the durable decision ledger. No actuator API is used.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from agentscope.app.message_bus import InMemoryMessageBus
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from mission_review import assess_record, recent_agent_feedback


EVENT_TYPES = {
    "TARGET_SUSPECTED", "VERIFY_REQUESTED", "VERIFY_ACCEPTED", "VERIFY_COMPLETED",
    "MISSION_PAUSED", "MISSION_RESUMED", "UAV_LOW_BATTERY",
    "UAV_RETURNED", "UAV_RELEASED", "UAV_RETURNING", "UAV_TARGET_REQUESTED",
    "UAV_COMMAND_REQUESTED",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _geometry(rings):
    polygons = [Polygon(ring) for ring in rings if len(ring) >= 3]
    return unary_union(polygons) if polygons else None


def _inside(rings, position):
    if (not isinstance(position, (list, tuple)) or len(position) != 2
            or not all(isinstance(value, (int, float)) for value in position)):
        return False
    geometry = _geometry(rings)
    return bool(geometry and geometry.buffer(.5).covers(Point(position)))


class TaskAgent:
    """A stable, event-woken mission role; proposals never mutate assets."""

    def __init__(self, identity: dict):
        self.identity = identity

    def suggest(self, event: dict, mission: dict):
        asset = self.identity
        if asset["kind"] == "uav":
            return {"agent_id": asset["agent_id"], "asset_id": asset["id"],
                    "decision": "REPORT_TARGET" if event["event_type"] == "TARGET_SUSPECTED" else "ACK_EVENT",
                    "reason": "仿真目标由搭载 UAV 报告" if event["event_type"] == "TARGET_SUSPECTED" else "状态事件已接收"}
        if event["event_type"] == "TARGET_SUSPECTED":
            owner = mission["assets"][event["sender_id"]]["carrier_id"]
            decision = "VERIFY_REQUESTED" if asset["id"] == owner else "CONTINUE_SCAN"
            return {"agent_id": asset["agent_id"], "asset_id": asset["id"],
                    "decision": decision,
                    "reason": "所属艇申请复核" if decision == "VERIFY_REQUESTED" else "保持现有分区扫描并关注共享观测"}
        return {"agent_id": asset["agent_id"], "asset_id": asset["id"],
                "decision": event["event_type"], "reason": "按任务事件处理"}


class CoordinatorAgent(TaskAgent):
    """Select only neighboring USV agents for a suspected target event."""

    def select_recipients(self, state: dict, owner_id: str, position: list[float]):
        owner_region = _geometry(state["assets"][owner_id]["region"])
        candidates = []
        for boat_id in state["boat_ids"]:
            if boat_id == owner_id:
                continue
            region = _geometry(state["assets"][boat_id]["region"])
            if region and owner_region and region.distance(owner_region) <= 1:
                candidates.append((region.distance(Point(position)), boat_id))
        return [boat_id for _, boat_id in sorted(candidates)[:2]]


class MissionTaskService:
    def __init__(self, bus: InMemoryMessageBus, advisor_timeout: float = 10.0,
                 review_timeout: float = 12.0):
        self.bus = bus
        self.advisor_timeout = advisor_timeout
        self.review_timeout = review_timeout

    @staticmethod
    def _file(scan_file: Path):
        return scan_file.with_suffix(".fleet.json")

    @staticmethod
    def _read(path: Path):
        return json.loads(path.read_text("utf-8")) if path.exists() else None

    @staticmethod
    def _write(path: Path, state: dict):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
        try:
            temporary.write_text(json.dumps(state, ensure_ascii=False), "utf-8")
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    async def assign(self, scan_file: Path, selected_ids: list[str], assignment_key: str):
        scan = self._read(scan_file)
        if not scan:
            raise ValueError("请先生成扫描航线")
        routes = scan.get("map", {}).get("routes") or []
        route_ids = [route["vessel_id"] for route in routes]
        if not route_ids or len(set(route_ids)) != len(route_ids) or set(selected_ids) != set(route_ids):
            raise ValueError("所选无人艇必须与当前规划航线一一对应")
        plan_hash = hashlib.sha256(json.dumps(routes, sort_keys=True).encode()).hexdigest()
        path = self._file(scan_file)
        async with self.bus.acquire_lock(str(path)):
            previous = self._read(path)
            if previous and previous["plan_hash"] == plan_hash and previous.get("assignment_key") == assignment_key and set(previous["boat_ids"]) == set(selected_ids):
                return previous
            mission_id = uuid4().hex
            assets = {}
            for route in routes:
                boat_id = route["vessel_id"]
                suffix = boat_id.removeprefix("USV-")
                drone_id = f"UAV-{suffix}"
                region = route.get("region", [])
                assets[boat_id] = {"id": boat_id, "agent_id": f"{mission_id}:{boat_id}",
                                   "kind": "usv", "carrier_id": None, "region": region,
                                   "mode": "scan", "online": True}
                assets[drone_id] = {"id": drone_id, "agent_id": f"{mission_id}:{drone_id}",
                                    "kind": "uav", "carrier_id": boat_id, "region": region,
                                    "mode": "deck", "online": True}
            state = {"mission_id": mission_id, "plan_hash": plan_hash,
                     "assignment_key": assignment_key,
                     "boat_ids": route_ids, "assets": assets, "events": {},
                     "created_at": _now(), "simulation": True, "paused": False}
            assets["coordinator"] = {"id": "coordinator", "agent_id": f"{mission_id}:coordinator",
                                     "kind": "coordinator", "carrier_id": None,
                                     "region": [], "mode": "active", "online": True}
            self._write(path, state)
            return state

    async def process(self, scan_file: Path, body: dict, advisor=None,
                      reviewer=None, refiner=None):
        path = self._file(scan_file)
        async with self.bus.acquire_lock(str(path)):
            state = self._read(path)
            if not state:
                raise ValueError("请先分配扫描任务")
            event_id = body.get("event_id")
            if not isinstance(event_id, str) or not event_id or len(event_id) > 100:
                raise ValueError("event_id 无效")
            if event_id in state["events"]:
                return {**state["events"][event_id], "duplicate": True}
            if body.get("mission_id") != state["mission_id"]:
                raise ValueError("任务 ID 与当前航线不匹配")
            event_type = body.get("event_type")
            if event_type not in EVENT_TYPES or event_type == "VERIFY_ACCEPTED":
                raise ValueError("事件类型不能由当前资产提交")
            sender_id = body.get("sender_id")
            asset = state["assets"].get(sender_id)
            if not asset:
                raise ValueError("发送资产不属于当前任务")
            position = body.get("position")
            if not isinstance(position, list) or len(position) != 2 or not all(
                    isinstance(value, (float, int)) and 0 <= value <= limit
                    for value, limit in zip(position, (1000, 625))):
                raise ValueError("事件位置无效")
            payload = body.get("payload") or {}
            if not isinstance(payload, dict):
                raise ValueError("payload 必须是对象")
            record = {"event_id": event_id, "mission_id": state["mission_id"],
                      "sender_id": sender_id, "recipient_ids": [], "event_type": event_type,
                      "timestamp": body.get("timestamp") or _now(), "position": position,
                      "payload": payload, "status": "received", "chain": [], "actions": [],
                      "simulation": True}

            def stage(kind, actor, detail, status="completed"):
                record["chain"].append({"stage": kind, "actor_id": actor, "detail": detail,
                                        "status": status, "timestamp": _now()})

            stage("sent", sender_id, f"{event_type} 仿真任务事件")
            if event_type != "TARGET_SUSPECTED":
                recipient_ids = [asset["carrier_id"]] if asset["kind"] == "uav" else []
                record["recipient_ids"] = recipient_ids
                for recipient_id in [sender_id, *recipient_ids]:
                    recipient = state["assets"][recipient_id]
                    if not recipient["online"]:
                        stage("received", recipient_id, "资产离线，未投递", "offline")
                        continue
                    key = f"mission:{state['mission_id']}:agent:{recipient['agent_id']}"
                    await self.bus.queue_push(key, record)
                    for _, delivered in await self.bus.queue_drain(key):
                        stage("received", recipient_id, "结构化事件已送达")
            error = None
            if event_type == "TARGET_SUSPECTED":
                if asset["kind"] != "uav" or asset["mode"] not in ("auto", "manual", "hover"):
                    error = "只有已释放的 UAV 可以报告疑似目标"
                elif not _inside(asset["region"], position):
                    error = "UAV 不得报告所属艇分区外的目标点"
                elif payload.get("target_position") and not _inside(asset["region"], payload["target_position"]):
                    error = "目标点位于所属艇分区外"
                else:
                    owner_id = asset["carrier_id"]
                    coordinator = CoordinatorAgent(state["assets"]["coordinator"])
                    recipients = [owner_id, *coordinator.select_recipients(state, owner_id, position)]
                    record["recipient_ids"] = recipients
                    record["review_context"] = {
                        "mission_paused": state["paused"],
                        "assets": {asset_id: {key: state["assets"][asset_id].get(key)
                                               for key in ("kind", "carrier_id", "mode", "online")}
                                   | {"position_in_region": _inside(state["assets"][asset_id]["region"], position)}
                                   for asset_id in [sender_id, *recipients]},
                    }
                    record["prior_feedback"] = {
                        asset_id: recent_agent_feedback(state["events"], asset_id)
                        for asset_id in [sender_id, *recipients]
                    }
                    proposals = {}
                    suggestion_jobs = []
                    routed = False

                    async def propose(recipient, delivered):
                        try:
                            suggestion = (await asyncio.wait_for(advisor(recipient, delivered), self.advisor_timeout)
                                          if advisor else TaskAgent(recipient).suggest(delivered, state))
                            if (not isinstance(suggestion, dict) or suggestion.get("decision") not in
                                    {"REPORT_TARGET", "RETURN_TO_CARRIER", "VERIFY_REQUESTED", "CONTINUE_SCAN", "PAUSE"}):
                                raise ValueError("Agent 建议格式无效")
                            allowed = ({"REPORT_TARGET"} if recipient["kind"] == "uav" else
                                       {"VERIFY_REQUESTED", "CONTINUE_SCAN"} if recipient["id"] == owner_id else
                                       {"VERIFY_REQUESTED", "CONTINUE_SCAN", "PAUSE"})
                            if suggestion["decision"] not in allowed:
                                raise ValueError("Agent 建议与资产角色不符")
                            return suggestion, None
                        except asyncio.TimeoutError:
                            return TaskAgent(recipient).suggest(delivered, state), "超时"
                        except Exception as exc:
                            return TaskAgent(recipient).suggest(delivered, state), type(exc).__name__

                    for recipient_id in [sender_id, *recipients]:
                        if recipient_id not in (sender_id, owner_id) and not routed:
                            stage("received", "coordinator", "所属艇报告已送达，开始向相关 USV 分发")
                            stage("suggested", "coordinator", f"仅分发给 {', '.join(recipients[1:])}")
                            routed = True
                        recipient = state["assets"][recipient_id]
                        if not recipient["online"] or recipient_id in payload.get("offline_ids", []):
                            stage("received", recipient_id, "资产离线，未投递", "offline")
                            continue
                        key = f"mission:{state['mission_id']}:agent:{recipient['agent_id']}"
                        await self.bus.queue_push(key, record)
                        for _, delivered in await self.bus.queue_drain(key):
                            stage("received", recipient_id, "结构化事件已送达")
                            delivered_for_agent = {**delivered,
                                                   "agent_feedback": record["prior_feedback"][recipient_id]}
                            suggestion_jobs.append((recipient_id, propose(recipient, delivered_for_agent)))
                    if suggestion_jobs:
                        results = await asyncio.gather(*(job for _, job in suggestion_jobs))
                        for (recipient_id, _), (suggestion, failure) in zip(suggestion_jobs, results):
                            if failure:
                                stage("fallback", recipient_id,
                                      f"建议调用{failure}，使用确定性建议", "fallback")
                            proposals[recipient_id] = suggestion
                            stage("suggested", recipient_id,
                                  suggestion["decision"] + " · " + str(suggestion.get("reason", "")))
                    if not routed:
                        stage("received", "coordinator", "所属艇报告已送达")
                        stage("suggested", "coordinator", "没有其他相邻 USV 需要接收")
                    record["proposals"] = proposals
                    record["original_proposals"] = {key: dict(value) for key, value in proposals.items()}
                    record["revisions"] = []
                    if reviewer and proposals:
                        try:
                            review = await asyncio.wait_for(reviewer(record), timeout=self.review_timeout)
                            if not isinstance(review, dict) or not isinstance(review.get("findings"), list):
                                raise ValueError("评议格式无效")
                            record["peer_review"] = {"status": "completed", **review}
                            stage("reviewed", "coordinator", review.get("summary", "已评议提案"))
                            if refiner:
                                for reviewed_id in dict.fromkeys(
                                        finding["asset_id"] for finding in review["findings"]
                                        if finding.get("asset_id") in proposals):
                                    findings = [finding for finding in review["findings"]
                                                if finding["asset_id"] == reviewed_id]
                                    recipient = state["assets"][reviewed_id]
                                    try:
                                        revised = await asyncio.wait_for(
                                            refiner(recipient, record, proposals[reviewed_id], findings),
                                            timeout=self.advisor_timeout,
                                        )
                                        allowed = ({"REPORT_TARGET"} if recipient["kind"] == "uav" else
                                                   {"VERIFY_REQUESTED", "CONTINUE_SCAN"} if reviewed_id == owner_id else
                                                   {"VERIFY_REQUESTED", "CONTINUE_SCAN", "PAUSE"})
                                        if not isinstance(revised, dict) or revised.get("decision") not in allowed:
                                            raise ValueError("修订建议与资产角色不符")
                                        before = proposals[reviewed_id]
                                        proposals[reviewed_id] = revised
                                        record["revisions"].append({"asset_id": reviewed_id,
                                                                    "before": before, "after": revised})
                                        stage("revised", reviewed_id, revised["decision"] + " · "
                                              + str(revised.get("reason", "")))
                                    except Exception:
                                        stage("fallback", reviewed_id, "修订失败或超时，保留原建议", "fallback")
                        except asyncio.TimeoutError:
                            record["peer_review"] = {"status": "unavailable", "reason": "评议调用超时"}
                            stage("fallback", "coordinator", "评议调用超时，保留原建议", "fallback")
                        except Exception as exc:
                            reason = f"评议失败（{type(exc).__name__}）"
                            record["peer_review"] = {"status": "unavailable", "reason": reason}
                            stage("fallback", "coordinator", reason + "，保留原建议", "fallback")
                    else:
                        record["peer_review"] = {"status": "unavailable", "reason": "未配置评议模型或没有提案"}
                    record["proposals"] = proposals
                    if state["assets"][owner_id]["online"] and owner_id not in payload.get("offline_ids", []):
                        if state["paused"] or payload.get("mission_paused"):
                            stage("validated", "coordinator", "任务已暂停，复核决定暂缓", "deferred")
                            record["status"] = "deferred"
                        elif state["assets"][owner_id]["mode"] not in ("scan", "paused"):
                            error = "所属 USV 当前状态不允许申请复核"
                        elif any(item["status"] == "completed" and item["event_type"] == "TARGET_SUSPECTED"
                                 and item["actions"] and item["actions"][0].get("boat_id") == owner_id
                                 for item in state["events"].values()):
                            error = "所属 USV 已有复核任务"
                        elif proposals.get(owner_id, {}).get("decision") == "VERIFY_REQUESTED":
                            stage("validated", "coordinator", "身份、归属、分区和任务冲突校验通过")
                            record["actions"] = [{"boat_id": owner_id, "action": "verify",
                                                  "observation_id": event_id}]
                            state["assets"][owner_id]["mode"] = "verify"
                            stage("executed", owner_id, "VERIFY_ACCEPTED · 开始仿真复核")
                            record["status"] = "completed"
                        else:
                            stage("validated", "coordinator", "所属 USV 建议继续扫描")
                            record["status"] = "completed"
                        for peer_id in recipients[1:]:
                            suggestion = proposals.get(peer_id)
                            if not suggestion:
                                continue
                            decision = suggestion["decision"]
                            peer = state["assets"][peer_id]
                            if decision == "PAUSE" and peer["mode"] == "scan":
                                peer["mode"] = "paused"
                                record["actions"].append({"boat_id": peer_id, "action": "pause",
                                                          "observation_id": event_id})
                                stage("validated", "coordinator", f"{peer_id} 暂停建议通过")
                                stage("executed", peer_id, "MISSION_PAUSED · 仿真暂停扫描")
                            elif decision == "VERIFY_REQUESTED":
                                if _inside(peer["region"], position) and peer["mode"] == "scan":
                                    peer["mode"] = "verify"
                                    record["actions"].append({"boat_id": peer_id, "action": "verify",
                                                              "observation_id": event_id})
                                    stage("validated", "coordinator", f"{peer_id} 分区复核建议通过")
                                    stage("executed", peer_id, "VERIFY_ACCEPTED · 仿真复核")
                                else:
                                    stage("validated", "coordinator", f"{peer_id} 复核建议超出分区或任务冲突", "rejected")
                            else:
                                stage("validated", "coordinator", f"{peer_id} 继续原分区扫描")
                    else:
                        stage("validated", "coordinator", "所属 USV 离线，复核暂缓", "offline")
                        record["status"] = "deferred"
            elif event_type == "UAV_RELEASED":
                if asset["kind"] != "uav" or asset["mode"] != "deck":
                    error = "UAV 状态不允许再次释放"
                else:
                    state["assets"][sender_id]["mode"] = "auto"
                    stage("validated", "coordinator", "UAV 与母艇绑定有效")
                    stage("executed", sender_id, "记录仿真放飞")
                    record["status"] = "completed"
            elif event_type == "UAV_TARGET_REQUESTED":
                target = payload.get("target_position")
                if asset["kind"] != "uav" or asset["mode"] not in ("auto", "manual", "hover"):
                    error = "只有已释放的 UAV 可以接受目标点"
                elif not isinstance(target, list) or len(target) != 2 or not _inside(asset["region"], target):
                    error = "UAV 不能接受所属 USV 分区外的目标点任务"
                else:
                    state["assets"][sender_id]["mode"] = "manual"
                    stage("validated", "coordinator", "目标点属于 UAV 母艇分区")
                    record["actions"] = [{"uav_id": sender_id, "action": "manual_target"}]
                    stage("executed", sender_id, "接收仿真目标点")
                    record["status"] = "completed"
            elif event_type == "UAV_COMMAND_REQUESTED":
                command = payload.get("command")
                if asset["kind"] != "uav" or asset["mode"] in ("deck", "return"):
                    error = "UAV 当前状态不接受飞行模式命令"
                elif command not in ("auto", "manual", "hover"):
                    error = "UAV 飞行模式命令无效"
                elif command == "manual" and any(
                        not isinstance(payload.get(name), (int, float))
                        or not math.isfinite(payload[name])
                        or not lower <= payload[name] <= upper
                        for name, lower, upper in (("speedMps", 0, 30),
                                                   ("headingDegrees", 0, 359),
                                                   ("altitudeM", 10, 120))):
                    error = "手动控制参数超出仿真范围"
                else:
                    state["assets"][sender_id]["mode"] = command
                    stage("validated", "coordinator", "UAV 身份、归属和状态转换合法")
                    record["actions"] = [{"uav_id": sender_id, "action": command}]
                    stage("executed", sender_id, f"仿真模式切换：{command}")
                    record["status"] = "completed"
            elif event_type == "UAV_RETURNING":
                if asset["kind"] != "uav" or asset["mode"] in ("deck", "return"):
                    error = "当前 UAV 状态不允许返航"
                else:
                    state["assets"][sender_id]["mode"] = "return"
                    stage("validated", "coordinator", "返航状态合法")
                    stage("executed", sender_id, "开始仿真返艇")
                    record["status"] = "completed"
            elif event_type == "UAV_LOW_BATTERY":
                if asset["kind"] != "uav" or asset["mode"] in ("deck", "return") or payload.get("battery", 101) > 35:
                    error = "低电量返航事件与 UAV 状态或电量不符"
                else:
                    state["assets"][sender_id]["mode"] = "return"
                    stage("validated", "coordinator", "电量低于阈值，返航状态合法")
                    record["actions"] = [{"uav_id": sender_id, "action": "return"}]
                    stage("executed", sender_id, "开始仿真返艇")
                    record["status"] = "completed"
            elif event_type == "UAV_RETURNED":
                if asset["kind"] != "uav" or asset["mode"] != "return":
                    error = "UAV 尚未处于返航状态"
                else:
                    state["assets"][sender_id]["mode"] = "deck"
                    stage("validated", "coordinator", "返艇状态合法")
                    stage("executed", sender_id, "仿真返艇完成")
                    record["status"] = "completed"
            elif event_type in ("MISSION_PAUSED", "MISSION_RESUMED", "VERIFY_REQUESTED", "VERIFY_COMPLETED"):
                if asset["kind"] == "coordinator" and event_type in ("MISSION_PAUSED", "MISSION_RESUMED"):
                    state["paused"] = event_type == "MISSION_PAUSED"
                    stage("validated", "coordinator", "仿真任务总暂停状态合法")
                    stage("executed", "coordinator", "暂停" if state["paused"] else "继续")
                    record["status"] = "completed"
                elif asset["kind"] != "usv":
                    error = "该事件只能由 USV 提交"
                elif event_type == "VERIFY_REQUESTED" and not _inside(asset["region"], position):
                    error = "复核目标不在该 USV 分区内"
                elif event_type == "VERIFY_REQUESTED" and asset["mode"] not in ("scan", "paused"):
                    error = "该 USV 已有冲突的复核任务"
                elif event_type == "MISSION_PAUSED" and asset["mode"] not in ("scan", "verify"):
                    error = "当前 USV 不能暂停"
                elif event_type == "MISSION_RESUMED" and asset["mode"] != "paused":
                    error = "当前 USV 未暂停"
                elif event_type == "VERIFY_COMPLETED" and asset["mode"] != "verify":
                    error = "当前 USV 没有正在执行的复核任务"
                else:
                    new_mode = {"MISSION_PAUSED": "paused", "MISSION_RESUMED": "scan",
                                "VERIFY_REQUESTED": "verify", "VERIFY_COMPLETED": "paused"}[event_type]
                    state["assets"][sender_id]["mode"] = new_mode
                    stage("validated", "coordinator", "任务归属、分区和状态转换合法")
                    record["actions"] = [{"boat_id": sender_id,
                                          "action": "pause" if new_mode == "paused" else "verify" if new_mode == "verify" else "continue",
                                          "observation_id": payload.get("observation_id")}]
                    stage("executed", sender_id, new_mode)
                    record["status"] = "completed"
            if error:
                stage("validated", "coordinator", error, "rejected")
                record["status"] = "rejected"
            if event_type == "TARGET_SUSPECTED":
                record["assessment"] = assess_record(record)
                record.setdefault("peer_review", {"status": "unavailable", "reason": "事件未形成可评议的提案"})
            state["events"][event_id] = record
            if event_type == "VERIFY_COMPLETED" and record["status"] == "completed":
                parent_id = payload.get("observation_id")
                parent = state["events"].get(parent_id) if isinstance(parent_id, str) else None
                if parent and parent.get("event_type") == "TARGET_SUSPECTED":
                    assessment = parent.get("assessment")
                    if assessment is not None:
                        assessment["verification_completed"] = True
                        try:
                            started = datetime.fromisoformat(parent["chain"][0]["timestamp"])
                            assessment["verification_elapsed_s"] = max(
                                0.0, round((datetime.now(timezone.utc) - started).total_seconds(), 3),
                            )
                        except (KeyError, IndexError, ValueError, TypeError):
                            pass
            if event_type == "TARGET_SUSPECTED" and record["status"] == "completed":
                for action in record["actions"]:
                    if action["action"] != "verify":
                        continue
                    boat_id = action["boat_id"]
                    for kind, sender, recipients in (
                            ("VERIFY_REQUESTED", boat_id, ["coordinator"]),
                            ("VERIFY_ACCEPTED", "coordinator", [boat_id])):
                        child_id = f"{event_id}:{kind}:{boat_id}"
                        state["events"][child_id] = {
                            "event_id": child_id, "mission_id": state["mission_id"],
                            "sender_id": sender, "recipient_ids": recipients,
                            "event_type": kind, "timestamp": _now(),
                            "position": position, "payload": {"parent_event_id": event_id},
                            "status": "completed", "chain": [{"stage": "executed",
                                "actor_id": sender, "detail": f"{kind} · 仿真复核",
                                "status": "completed", "timestamp": _now()}],
                            "actions": [], "simulation": True,
                        }
            self._write(path, state)
            return record

    def get(self, scan_file: Path):
        return self._read(self._file(scan_file))
