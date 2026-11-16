"""Evidence-bound peer review for simulated mission proposals."""

import json

from pydantic import BaseModel, Field

from agentscope.message import UserMsg


class ReviewFinding(BaseModel):
    asset_id: str
    concern: str = Field(min_length=1, max_length=240)
    evidence: str = Field(min_length=1, max_length=240)


class MissionPeerReview(BaseModel):
    findings: list[ReviewFinding] = Field(default_factory=list, max_length=5)
    summary: str = Field(min_length=1, max_length=400)


def recent_agent_feedback(events: dict, asset_id: str, limit: int = 3) -> list[dict]:
    """Return bounded, factual review history for one asset within a mission."""
    feedback = []
    for record in reversed(list(events.values())):
        if record.get("event_type") != "TARGET_SUSPECTED":
            continue
        findings = [item for item in record.get("peer_review", {}).get("findings", [])
                    if item.get("asset_id") == asset_id]
        if not findings:
            continue
        feedback.append({"event_id": record["event_id"],
                         "findings": findings[:2],
                         "verification_completed": record.get("assessment", {}).get("verification_completed")})
        if len(feedback) >= limit:
            break
    return feedback


def _evidence_value(record: dict, path: str):
    """Resolve a predecision field, returning an existence flag and its value."""
    if not path.startswith(("review_context.", "proposals.")):
        return False, None
    value = record
    for segment in path.split("."):
        if not isinstance(value, dict) or segment not in value:
            return False, None
        value = value[segment]
    return True, value


def assess_record(record: dict) -> dict:
    """Score only facts present in the event ledger; no outcome is inferred."""
    proposals = record.get("proposals", {})
    stages = record.get("chain", [])
    rejected = [stage for stage in stages if stage["stage"] == "validated"
                and stage["status"] == "rejected"]
    fallbacks = [stage for stage in stages if stage["stage"] == "fallback"]
    return {
        "proposal_count": len(proposals),
        "validation_rejection_count": len(rejected),
        "advisor_fallback_count": len(fallbacks),
        "executed_action_count": len(record.get("actions", [])),
        "revision_count": len(record.get("revisions", [])),
        "verification_completed": False,
        "verification_elapsed_s": None,
        "outcome_score": None,
        "outcome_score_reason": "尚无复核结果和覆盖率数据，不能评价任务成效",
    }


async def generate_peer_review(model, record: dict) -> dict:
    """Critique proposals before action; require references to existing facts."""
    context = {key: record.get(key) for key in (
        "event_id", "event_type", "position", "payload", "status",
        "proposals", "review_context", "actions", "chain",
    )}
    response = await model.generate_structured_output(
        messages=[UserMsg(
            name="mission_peer_review",
            content=(
                "Review proposals for this simulated maritime target event before action. "
                "Identify concrete defects only. For each finding, evidence must be an "
                "exact dot path under review_context or proposals in the supplied JSON. "
                "Do not invent sensor readings, coverage, response time, or target truth. "
                "An empty findings list is valid. You cannot command assets.\n"
                + json.dumps(context, ensure_ascii=False)
            ),
        )],
        structured_model=MissionPeerReview,
    )
    review = MissionPeerReview.model_validate(response.content)
    allowed = set(record.get("proposals", {})) | {"coordinator"}
    if any(item.asset_id not in allowed for item in review.findings):
        raise ValueError("评议引用了不属于本次事件的资产")
    result = review.model_dump()
    for finding in result["findings"]:
        exists, value = _evidence_value(record, finding["evidence"])
        if not exists:
            raise ValueError("评议引用了不存在的证据字段")
        finding["evidence_value"] = value
    return result
