"""Optional AgentScope model advice for simulated, event-woken task agents.

The model only returns a proposal. MissionTaskService validates and applies it.
"""

import json
from typing import Literal

from pydantic import BaseModel, Field

from agentscope.message import UserMsg


class TaskProposal(BaseModel):
    decision: Literal[
        "REPORT_TARGET", "RETURN_TO_CARRIER", "VERIFY_REQUESTED",
        "CONTINUE_SCAN", "PAUSE",
    ]
    reason: str = Field(min_length=1, max_length=160)


def make_advisor(model):
    """Return an advisor compatible with MissionTaskService.process."""

    async def advise(asset: dict, event: dict) -> dict:
        owner_id = event["sender_id"].replace("UAV-", "USV-", 1)
        role = (
            "reporting UAV: use REPORT_TARGET"
            if asset["kind"] == "uav"
            else "carrier USV: choose VERIFY_REQUESTED or CONTINUE_SCAN"
            if asset["id"] == owner_id
            else "related USV: choose CONTINUE_SCAN, PAUSE, or VERIFY_REQUESTED"
        )
        context = {
            "agent_id": asset["agent_id"], "asset_id": asset["id"],
            "carrier_id": asset.get("carrier_id"), "role": role,
            "event_id": event["event_id"], "event_type": event["event_type"],
            "position": event["position"], "simulation": True,
            "recent_feedback": event.get("agent_feedback", []),
        }
        response = await model.generate_structured_output(
            messages=[UserMsg(
                name="mission_task",
                content=(
                    "This is a simulated maritime search task. Suggest one task action "
                    "for this asset only. Never issue a vehicle command or claim a real "
                    "sensor detection. Keep the reason brief. The deterministic service "
                    "will check ownership, region and conflicts before execution.\n"
                    + json.dumps(context, ensure_ascii=False)
                ),
            )],
            structured_model=TaskProposal,
        )
        proposal = TaskProposal.model_validate(response.content)
        return {"agent_id": asset["agent_id"], "asset_id": asset["id"],
                **proposal.model_dump()}

    return advise


def make_refiner(model):
    """Return one revised proposal after an evidence-bound peer critique."""

    async def refine(asset: dict, event: dict, proposal: dict, findings: list[dict]) -> dict:
        response = await model.generate_structured_output(
            messages=[UserMsg(
                name="mission_task_refine",
                content=(
                    "This is a simulated maritime search task. Reconsider your proposal "
                    "using the peer findings and recorded facts. Return one action for "
                    "this asset only. You may keep the original decision. Never issue "
                    "a vehicle command or claim a real sensor detection.\n"
                    + json.dumps({"asset": {key: asset.get(key) for key in
                                           ("id", "agent_id", "kind", "carrier_id", "mode")},
                                  "event": {key: event.get(key) for key in
                                            ("event_id", "event_type", "position")},
                                  "proposal": proposal, "findings": findings}, ensure_ascii=False)
                ),
            )],
            structured_model=TaskProposal,
        )
        revised = TaskProposal.model_validate(response.content)
        return {"agent_id": asset["agent_id"], "asset_id": asset["id"],
                **revised.model_dump()}

    return refine
