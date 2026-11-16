"""Integration checks for AgentScope 2 mission event delivery and validation."""

import asyncio
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from agentscope.app.message_bus import InMemoryMessageBus
from fastapi.testclient import TestClient

import main
from mission_task_agents import MissionTaskService
from mission_model_advisor import make_advisor
from mission_review import generate_peer_review
from mission_chat_state import _wgs84, read_snapshot, save_snapshot


def square(left, top, right, bottom):
    return [[left, top], [right, top], [right, bottom], [left, bottom]]


class MissionTaskAgentsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.scan_file = Path(__file__).parent / f"task-test-{uuid4().hex}.json"
        self.addCleanup(lambda: self.scan_file.unlink(missing_ok=True))
        self.addCleanup(lambda: self.scan_file.with_suffix(".fleet.json").unlink(missing_ok=True))
        self.addCleanup(lambda: self.scan_file.with_suffix(".chat-state.json").unlink(missing_ok=True))
        routes = []
        for index, bounds in enumerate(((0, 0, 500, 300), (500, 0, 1000, 300),
                                        (0, 300, 500, 625), (500, 300, 1000, 625)), 1):
            routes.append({"vessel_id": f"USV-{index:02d}",
                           "waypoints": [[bounds[0] + 20, bounds[1] + 20],
                                         [bounds[2] - 20, bounds[3] - 20]],
                           "region": [square(*bounds)]})
        self.scan_file.write_text(json.dumps({"map": {"routes": routes}}), "utf-8")
        self.bus = InMemoryMessageBus()
        self.service = MissionTaskService(self.bus)
        self.mission = await self.service.assign(self.scan_file,
                                                 [route["vessel_id"] for route in routes], "test-assignment")

    def event(self, event_id, sender, kind, position, **payload):
        return {"event_id": event_id, "mission_id": self.mission["mission_id"],
                "sender_id": sender, "event_type": kind, "position": position,
                "payload": payload}

    async def test_four_boats_target_chain_and_idempotency(self):
        launch = await self.service.process(self.scan_file, self.event("launch-1", "UAV-01", "UAV_RELEASED", [100, 100]))
        self.assertEqual(launch["status"], "completed")
        self.assertNotIn("suggested", [entry["stage"] for entry in launch["chain"]])
        self.assertNotIn("RETURN_TO_CARRIER", json.dumps(launch))
        report = self.event("target-1", "UAV-01", "TARGET_SUSPECTED", [480, 280])
        result = await self.service.process(self.scan_file, report)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["proposals"]["USV-01"]["decision"], "VERIFY_REQUESTED")
        self.assertEqual(result["assessment"]["proposal_count"], 4)
        self.assertIsNone(result["assessment"]["outcome_score"])
        self.assertEqual(result["peer_review"]["status"], "unavailable")
        self.assertEqual(result["recipient_ids"], ["USV-01", "USV-02", "USV-03"])
        self.assertEqual([action["boat_id"] for action in result["actions"]], ["USV-01"])
        self.assertTrue({"sent", "received", "suggested", "validated", "executed"}
                        <= {entry["stage"] for entry in result["chain"]})
        self.assertNotIn("USV-04", [entry["actor_id"] for entry in result["chain"]])
        duplicate = await self.service.process(self.scan_file, report)
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(len(self.service.get(self.scan_file)["events"]), 4)
        self.assertEqual(self.service.get(self.scan_file)["events"]["target-1:VERIFY_ACCEPTED:USV-01"]["event_type"], "VERIFY_ACCEPTED")
        self.assertEqual(self.service.get(self.scan_file)["assets"]["USV-01"]["mode"], "verify")
        completed = await self.service.process(self.scan_file, self.event(
            "verified-1", "USV-01", "VERIFY_COMPLETED", [480, 280], observation_id="target-1"))
        self.assertEqual(completed["status"], "completed")
        outcome = self.service.get(self.scan_file)["events"]["target-1"]["assessment"]
        self.assertTrue(outcome["verification_completed"])
        self.assertIsNotNone(outcome["verification_elapsed_s"])
        resumed = await self.service.process(self.scan_file, self.event(
            "resume-1", "USV-01", "MISSION_RESUMED", [480, 280], observation_id="target-1"))
        self.assertEqual(resumed["status"], "completed")
        self.assertEqual(self.service.get(self.scan_file)["assets"]["USV-01"]["mode"], "scan")

    async def test_uav_cannot_accept_other_boat_region_target(self):
        await self.service.process(self.scan_file, self.event("launch-2", "UAV-02", "UAV_RELEASED", [600, 100]))
        rejected = await self.service.process(self.scan_file, self.event(
            "target-outside", "UAV-02", "UAV_TARGET_REQUESTED", [600, 100],
            target_position=[100, 500]))
        self.assertEqual(rejected["status"], "rejected")
        self.assertEqual(rejected["actions"], [])
        self.assertEqual(self.service.get(self.scan_file)["assets"]["UAV-02"]["mode"], "auto")

    async def test_low_battery_return_and_model_failure_fallback(self):
        await self.service.process(self.scan_file, self.event("launch-3", "UAV-01", "UAV_RELEASED", [100, 100]))
        async def failed_advisor(*_):
            raise RuntimeError("model unavailable")
        report = await self.service.process(self.scan_file, self.event(
            "target-fallback", "UAV-01", "TARGET_SUSPECTED", [100, 100]), failed_advisor)
        self.assertIn("fallback", [item["stage"] for item in report["chain"]])
        low = await self.service.process(self.scan_file, self.event(
            "battery-1", "UAV-01", "UAV_LOW_BATTERY", [100, 100], battery=34))
        self.assertEqual(low["actions"], [{"uav_id": "UAV-01", "action": "return"}])
        returned = await self.service.process(self.scan_file, self.event(
            "returned-1", "UAV-01", "UAV_RETURNED", [100, 100]))
        self.assertEqual(returned["status"], "completed")
        self.assertEqual(self.service.get(self.scan_file)["assets"]["UAV-01"]["mode"], "deck")

    async def test_paused_and_offline_are_not_left_running(self):
        await self.service.process(self.scan_file, self.event("launch-4", "UAV-01", "UAV_RELEASED", [100, 100]))
        result = await self.service.process(self.scan_file, self.event(
            "target-paused", "UAV-01", "TARGET_SUSPECTED", [100, 100],
            mission_paused=True, offline_ids=["USV-02"]))
        self.assertEqual(result["status"], "deferred")
        self.assertEqual(result["actions"], [])
        self.assertIn("offline", [entry["status"] for entry in result["chain"]])

    async def test_coordinator_pause_defers_and_resume_allows_report(self):
        await self.service.process(self.scan_file, self.event("launch-7", "UAV-01", "UAV_RELEASED", [100, 100]))
        paused = await self.service.process(self.scan_file, self.event(
            "pause-all", "coordinator", "MISSION_PAUSED", [0, 0]))
        self.assertEqual(paused["status"], "completed")
        report = await self.service.process(self.scan_file, self.event(
            "target-while-paused", "UAV-01", "TARGET_SUSPECTED", [100, 100]))
        self.assertEqual(report["status"], "deferred")
        await self.service.process(self.scan_file, self.event(
            "resume-all", "coordinator", "MISSION_RESUMED", [0, 0]))
        later = await self.service.process(self.scan_file, self.event(
            "target-after-resume", "UAV-01", "TARGET_SUSPECTED", [100, 100]))
        self.assertEqual(later["status"], "completed")

    async def test_peer_suggestion_is_checked_before_execution(self):
        await self.service.process(self.scan_file, self.event("launch-5", "UAV-01", "UAV_RELEASED", [100, 100]))
        async def suggest(recipient, event):
            del event
            if recipient["id"] == "USV-02":
                return {"decision": "PAUSE", "reason": "等待目标共享"}
            if recipient["id"] == "USV-03":
                return {"decision": "VERIFY_REQUESTED", "reason": "请求跨区复核"}
            return {"decision": "VERIFY_REQUESTED" if recipient["kind"] == "usv" else "REPORT_TARGET"}
        result = await self.service.process(self.scan_file, self.event(
            "target-peer", "UAV-01", "TARGET_SUSPECTED", [480, 280]), suggest)
        self.assertIn({"boat_id": "USV-02", "action": "pause", "observation_id": "target-peer"}, result["actions"])
        self.assertFalse(any(action.get("boat_id") == "USV-03" for action in result["actions"]))
        self.assertEqual(self.service.get(self.scan_file)["assets"]["USV-02"]["mode"], "paused")
        self.assertEqual(self.service.get(self.scan_file)["assets"]["USV-03"]["mode"], "scan")

    async def test_advisor_timeout_has_deterministic_fallback(self):
        self.service.advisor_timeout = .01
        await self.service.process(self.scan_file, self.event("launch-6", "UAV-01", "UAV_RELEASED", [100, 100]))
        async def slow_advisor(*_):
            await asyncio.sleep(1)
        result = await self.service.process(self.scan_file, self.event(
            "target-timeout", "UAV-01", "TARGET_SUSPECTED", [100, 100]), slow_advisor)
        self.assertEqual(result["status"], "completed")
        self.assertIn("fallback", [entry["stage"] for entry in result["chain"]])
        self.assertEqual(result["assessment"]["advisor_fallback_count"], 4)

    async def test_agent_proposals_are_requested_concurrently(self):
        await self.service.process(self.scan_file, self.event("launch-parallel", "UAV-01", "UAV_RELEASED", [100, 100]))
        ready = asyncio.Event()
        started = 0

        async def advisor(asset, _event):
            nonlocal started
            started += 1
            if started == 4:
                ready.set()
            await asyncio.wait_for(ready.wait(), timeout=.2)
            return {"decision": "REPORT_TARGET" if asset["kind"] == "uav" else
                    "VERIFY_REQUESTED" if asset["id"] == "USV-01" else "CONTINUE_SCAN",
                    "reason": "并发建议"}

        record = await self.service.process(self.scan_file, self.event(
            "target-parallel", "UAV-01", "TARGET_SUSPECTED", [100, 100]), advisor)
        self.assertEqual(started, 4)
        self.assertEqual(record["assessment"]["advisor_fallback_count"], 0)

    async def test_review_timeout_has_distinct_reason(self):
        self.service.review_timeout = .01
        await self.service.process(self.scan_file, self.event("launch-review-timeout", "UAV-01", "UAV_RELEASED", [100, 100]))

        async def slow_review(_record):
            await asyncio.sleep(1)

        record = await self.service.process(self.scan_file, self.event(
            "target-review-timeout", "UAV-01", "TARGET_SUSPECTED", [100, 100]),
            reviewer=slow_review)
        self.assertEqual(record["peer_review"]["reason"], "评议调用超时")
        self.assertEqual(record["actions"][0]["boat_id"], "USV-01")

    async def test_peer_review_requires_recorded_evidence_and_asset(self):
        await self.service.process(self.scan_file, self.event("launch-review", "UAV-01", "UAV_RELEASED", [100, 100]))

        class Model:
            async def generate_structured_output(self, messages, structured_model):
                self_test.assertEqual(messages[0].name, "mission_peer_review")
                self_test.assertEqual(structured_model.__name__, "MissionPeerReview")
                return type("Response", (), {"content": {
                    "findings": [{"asset_id": "USV-01", "concern": "检查分区边界",
                                  "evidence": "review_context.assets.USV-01.position_in_region"}],
                    "summary": "需核对边界",
                }})()

        self_test = self
        async def reviewer(record):
            return await generate_peer_review(Model(), record)

        async def refiner(asset, event, proposal, findings):
            self.assertEqual(asset["id"], "USV-01")
            self.assertEqual(findings[0]["evidence"], "review_context.assets.USV-01.position_in_region")
            return {"decision": "CONTINUE_SCAN", "reason": "评议后暂不复核"}

        record = await self.service.process(self.scan_file, self.event(
            "target-review", "UAV-01", "TARGET_SUSPECTED", [100, 100]),
            reviewer=reviewer, refiner=refiner)
        self.assertEqual(record["peer_review"]["status"], "completed")
        self.assertTrue(record["peer_review"]["findings"][0]["evidence_value"])
        self.assertEqual(record["original_proposals"]["USV-01"]["decision"], "VERIFY_REQUESTED")
        self.assertEqual(record["proposals"]["USV-01"]["decision"], "CONTINUE_SCAN")
        self.assertEqual(record["assessment"]["revision_count"], 1)
        self.assertEqual(record["actions"], [])
        feedback_seen = {}

        async def next_advisor(asset, event):
            feedback_seen[asset["id"]] = event["agent_feedback"]
            decision = ("REPORT_TARGET" if asset["kind"] == "uav" else
                        "VERIFY_REQUESTED" if asset["id"] == "USV-01" else "CONTINUE_SCAN")
            return {"decision": decision, "reason": "下一次事件"}

        await self.service.process(self.scan_file, self.event(
            "target-after-feedback", "UAV-01", "TARGET_SUSPECTED", [100, 100]),
            advisor=next_advisor)
        self.assertEqual(feedback_seen["USV-01"][0]["event_id"], "target-review")
        self.assertEqual(feedback_seen["USV-01"][0]["findings"][0]["evidence_value"], True)

        class UnknownAsset(Model):
            async def generate_structured_output(self, messages, structured_model):
                return type("Response", (), {"content": {
                    "findings": [{"asset_id": "USV-99", "concern": "问题", "evidence": "字段"}],
                    "summary": "未知资产",
                }})()

        with self.assertRaises(ValueError):
            await generate_peer_review(UnknownAsset(), record)

        class UnknownEvidence(Model):
            async def generate_structured_output(self, messages, structured_model):
                return type("Response", (), {"content": {
                    "findings": [{"asset_id": "USV-01", "concern": "问题",
                                  "evidence": "review_context.assets.USV-01.unknown"}],
                    "summary": "无效证据",
                }})()

        with self.assertRaises(ValueError):
            await generate_peer_review(UnknownEvidence(), record)

    async def test_review_failure_keeps_original_action(self):
        await self.service.process(self.scan_file, self.event("launch-review-fail", "UAV-01", "UAV_RELEASED", [100, 100]))

        async def failed_review(_record):
            raise RuntimeError("judge unavailable")

        record = await self.service.process(self.scan_file, self.event(
            "target-review-fail", "UAV-01", "TARGET_SUSPECTED", [100, 100]),
            reviewer=failed_review)
        self.assertEqual(record["peer_review"]["status"], "unavailable")
        self.assertEqual(record["actions"][0]["boat_id"], "USV-01")
        self.assertEqual(record["revisions"], [])

    async def test_invalid_revision_is_rejected_before_action(self):
        await self.service.process(self.scan_file, self.event("launch-invalid-revision", "UAV-01", "UAV_RELEASED", [100, 100]))

        async def reviewer(_record):
            return {"summary": "建议复查", "findings": [{"asset_id": "USV-01", "concern": "检查", "evidence": "review_context.assets.USV-01.mode"}]}

        async def invalid_refiner(*_args):
            return {"decision": "PAUSE", "reason": "非法的所属艇修订"}

        record = await self.service.process(self.scan_file, self.event(
            "target-invalid-revision", "UAV-01", "TARGET_SUSPECTED", [100, 100]),
            reviewer=reviewer, refiner=invalid_refiner)
        self.assertEqual(record["actions"][0]["boat_id"], "USV-01")
        self.assertEqual(record["revisions"], [])
        self.assertIn("fallback", [step["stage"] for step in record["chain"]])

    async def test_chat_snapshot_is_bound_to_current_mission_and_plan(self):
        self.assertEqual(_wgs84({"bounds": {"west": 119.68, "east": 119.72,
                                             "north": 25.57, "south": 25.53},
                                  "map": {"region": [square(0, 0, 1000, 625)]}}, [500, 312.5]),
                         [119.7, 25.55])
        tools = await main.mission_scan_tools("user", "agent", "session")
        self.assertIn("ReadMissionSituation", [tool.name for tool in tools])
        with patch.object(main, "_scan_file", return_value=self.scan_file):
            response = await next(tool for tool in tools if tool.name == "ReadMissionSituation").call()
            self.assertIsNotNone(response)
        body = {"mission_id": self.mission["mission_id"],
                "selected": {"kind": "uav", "id": "UAV-01"},
                "assets": [{"id": "UAV-01", "kind": "uav", "position": [100, 100],
                            "battery": 80, "progress": 0, "mode": "auto"}],
                "observations": []}
        self.assertEqual(save_snapshot(self.scan_file, body)["selected"]["id"], "UAV-01")
        self.assertEqual(read_snapshot(self.scan_file)["status"], "ready")
        self.assertEqual(read_snapshot(self.scan_file)["assets"][0]["position_source"], "simulation")
        with self.assertRaises(ValueError):
            save_snapshot(self.scan_file, {**body, "mission_id": "another-session"})
        with self.assertRaises(ValueError):
            save_snapshot(self.scan_file, {**body, "selected": {"kind": "uav", "id": "UAV-99"}})
        scan = json.loads(self.scan_file.read_text("utf-8"))
        scan["map"]["routes"][0]["region"] = [square(0, 0, 100, 100)]
        self.scan_file.write_text(json.dumps(scan), "utf-8")
        self.assertEqual(read_snapshot(self.scan_file)["status"], "unavailable")

    async def test_agentscope_structured_model_api_and_role_guard(self):
        await self.service.process(self.scan_file, self.event("launch-model", "UAV-01", "UAV_RELEASED", [100, 100]))

        class Model:
            async def generate_structured_output(self, messages, structured_model):
                self_test.assertEqual(messages[0].name, "mission_task")
                self_test.assertEqual(structured_model.__name__, "TaskProposal")
                return type("Response", (), {"content": {"decision": "VERIFY_REQUESTED", "reason": "建议复核"}})()

        self_test = self
        result = await self.service.process(self.scan_file, self.event(
            "target-model", "UAV-01", "TARGET_SUSPECTED", [100, 100]), make_advisor(Model()))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["actions"][0]["boat_id"], "USV-01")
        self.assertIn("fallback", [entry["stage"] for entry in result["chain"]])


class MissionTaskApiTest(unittest.TestCase):
    def test_assign_release_and_report_over_app_routes(self):
        user_id = f"task-api-{uuid4().hex}"
        agent_id = "task-test-agent"
        session_id = "task-test-session"
        with patch.object(main, "SCAN_RESULTS_DIR", Path(__file__).parent):
            scan_file = main._scan_file(user_id, agent_id, session_id)
            routes = [{"vessel_id": "USV-01", "waypoints": [[10, 10], [200, 100]],
                       "region": [square(0, 0, 500, 300)]},
                      {"vessel_id": "USV-02", "waypoints": [[600, 10], [800, 100]],
                       "region": [square(500, 0, 1000, 300)]}]
            scan_file.write_text(json.dumps({"map": {"routes": routes}}), "utf-8")
            try:
                client = TestClient(main.app)
                url = f"/mission/scan/{session_id}/fleet"
                query = {"agent_id": agent_id}
                headers = {"X-User-ID": user_id}
                assigned = client.post(url + "/assign", params=query, headers=headers,
                                       json={"selected_ids": ["USV-01", "USV-02"],
                                             "assignment_key": "api-test"})
                self.assertEqual(assigned.status_code, 200, assigned.text)
                mission_id = assigned.json()["mission_id"]
                event = {"event_id": "api-release", "mission_id": mission_id,
                         "sender_id": "UAV-01", "event_type": "UAV_RELEASED",
                         "position": [100, 100], "payload": {}}
                released = client.post(url + "/events", params=query, headers=headers, json=event)
                self.assertEqual(released.status_code, 200, released.text)
                self.assertEqual(released.json()["status"], "completed")
                event.update(event_id="api-report", event_type="TARGET_SUSPECTED")
                reported = client.post(url + "/events", params=query, headers=headers, json=event)
                self.assertEqual(reported.status_code, 200, reported.text)
                self.assertEqual(reported.json()["recipient_ids"], ["USV-01", "USV-02"])
                self.assertEqual(client.get(url, params=query, headers=headers).json()["events"]["api-report"]["status"], "completed")
                chat_url = f"/mission/scan/{session_id}/chat-state"
                snapshot = {"mission_id": mission_id,
                            "selected": {"kind": "uav", "id": "UAV-01"},
                            "assets": [{"id": "UAV-01", "kind": "uav", "position": [100, 100],
                                        "battery": 75, "progress": 0, "mode": "auto"}],
                            "observations": [{"id": "api-report", "source_id": "UAV-01",
                                              "position": [100, 100], "observed_at": "2026-11-11T10:00:00Z",
                                              "verified_by": None}]}
                saved = client.post(chat_url, params=query, headers=headers, json=snapshot)
                self.assertEqual(saved.status_code, 200, saved.text)
                self.assertEqual(client.get(chat_url, params=query, headers=headers).json()["assets"][0]["battery"], 75)
                self.assertEqual(client.get(chat_url, params=query, headers=headers).json()["position_coordinate_system"], "internal_map_xy_1000x625")
                self.assertEqual(client.get(chat_url, params=query, headers={"X-User-ID": "other-user"}).json()["status"], "unavailable")
                self.assertEqual(client.delete(chat_url, params=query, headers=headers).status_code, 200)
                self.assertEqual(client.get(chat_url, params=query, headers=headers).json()["status"], "unavailable")
            finally:
                scan_file.with_suffix(".chat-state.json").unlink(missing_ok=True)
                scan_file.with_suffix(".fleet.json").unlink(missing_ok=True)
                scan_file.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
