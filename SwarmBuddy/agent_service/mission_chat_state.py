"""Session-scoped, read-only snapshot of the browser's mission simulation."""

import hashlib
import json
import math
import os
from pathlib import Path
from uuid import uuid4


def _plan_hash(scan: dict) -> str:
    return hashlib.sha256(json.dumps(scan.get("map", {}).get("routes") or [], sort_keys=True).encode()).hexdigest()


def _path(scan_file: Path) -> Path:
    return scan_file.with_suffix(".chat-state.json")


def _read_json(path: Path):
    return json.loads(path.read_text("utf-8")) if path.exists() else None


def _wgs84(scan: dict, position: list[float]) -> list[float] | None:
    rings = scan.get("map", {}).get("region") or []
    vertices = [point for ring in rings for point in ring]
    bounds = scan.get("bounds") or {}
    if not vertices or not all(key in bounds for key in ("west", "east", "north", "south")):
        return None
    west, east = min(point[0] for point in vertices), max(point[0] for point in vertices)
    north, south = min(point[1] for point in vertices), max(point[1] for point in vertices)
    if east <= west or south <= north:
        return None
    longitude = bounds["west"] + (position[0] - west) / (east - west) * (bounds["east"] - bounds["west"])
    latitude = bounds["north"] - (position[1] - north) / (south - north) * (bounds["north"] - bounds["south"])
    return [round(longitude, 6), round(latitude, 6)]


def save_snapshot(scan_file: Path, body: dict) -> dict:
    scan = _read_json(scan_file)
    if not scan:
        raise ValueError("当前会话没有扫描方案")
    fleet = _read_json(scan_file.with_suffix(".fleet.json"))
    mission_id = body.get("mission_id")
    if not fleet or mission_id != fleet.get("mission_id") or fleet.get("plan_hash") != _plan_hash(scan):
        raise ValueError("任务 ID 与当前会话扫描方案不匹配")
    assets = body.get("assets")
    if not isinstance(assets, list) or len(assets) > 16:
        raise ValueError("资产快照格式无效")
    accepted = []
    seen = set()
    for item in assets:
        if not isinstance(item, dict) or item.get("id") not in fleet["assets"] or item["id"] in seen:
            raise ValueError("资产不属于当前任务或重复")
        registered = fleet["assets"][item["id"]]
        if registered["kind"] not in ("usv", "uav") or item.get("kind") != registered["kind"]:
            raise ValueError("资产类型不匹配")
        position = item.get("position")
        battery = item.get("battery")
        progress = item.get("progress")
        if (not isinstance(position, list) or len(position) != 2 or
                any(not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= limit
                    for value, limit in zip(position, (1000, 625))) or
                not isinstance(battery, (int, float)) or not math.isfinite(battery) or not 0 <= battery <= 100 or
                not isinstance(progress, (int, float)) or not math.isfinite(progress) or not 0 <= progress <= 1):
            raise ValueError("资产仿真数值无效")
        accepted.append({"id": item["id"], "kind": registered["kind"],
                         "carrier_id": registered.get("carrier_id"), "position": position,
                         "battery": battery, "progress": progress,
                         "mode": str(item.get("mode", "unknown"))[:30]})
        seen.add(item["id"])
    selected = body.get("selected")
    if selected is not None and (not isinstance(selected, dict) or selected.get("kind") not in
                                 ("usv", "uav", "region", "target") or not isinstance(selected.get("id"), str)):
        raise ValueError("地图选中对象格式无效")
    if selected and selected["kind"] in ("usv", "uav", "region"):
        asset_id = selected["id"] if selected["kind"] != "region" else selected["id"]
        if asset_id not in fleet["assets"]:
            raise ValueError("选中对象不属于当前任务")
    observations = body.get("observations") or []
    if not isinstance(observations, list) or len(observations) > 16:
        raise ValueError("目标快照格式无效")
    targets = []
    for item in observations:
        if not isinstance(item, dict) or item.get("source_id") not in fleet["assets"]:
            raise ValueError("目标来源不属于当前任务")
        position = item.get("position")
        if (not isinstance(position, list) or len(position) != 2 or
                any(not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= limit
                    for value, limit in zip(position, (1000, 625)))):
            raise ValueError("仿真目标位置无效")
        targets.append({"id": str(item.get("id", ""))[:100],
                        "source_id": item["source_id"], "position": position,
                        "observed_at": str(item.get("observed_at", ""))[:50],
                        "verified_by": item.get("verified_by")})
    if selected and selected["kind"] == "target" and selected["id"] != "latest" and not any(
            target["id"] == selected["id"] for target in targets):
        raise ValueError("选中的训练目标不属于当前任务")
    snapshot = {"mission_id": mission_id, "plan_hash": fleet["plan_hash"],
                "selected": selected, "assets": accepted, "observations": targets,
                "source": "browser_simulation"}
    path = _path(scan_file)
    temporary = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False), "utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return snapshot


def read_snapshot(scan_file: Path) -> dict:
    scan = _read_json(scan_file)
    fleet = _read_json(scan_file.with_suffix(".fleet.json"))
    snapshot = _read_json(_path(scan_file))
    if not scan or not fleet or not snapshot or (snapshot.get("mission_id") != fleet.get("mission_id")
        or snapshot.get("plan_hash") != fleet.get("plan_hash") or fleet.get("plan_hash") != _plan_hash(scan)):
        return {"status": "unavailable", "message": "当前会话没有与现有扫描方案匹配的仿真状态快照"}
    return {"status": "ready", **snapshot,
            "assets": [{**asset, "position_wgs84": _wgs84(scan, asset["position"]),
                        "position_source": "simulation"} for asset in snapshot["assets"]],
            "observations": [{**target, "position_wgs84": _wgs84(scan, target["position"]),
                              "observation_source": "simulated_training_target"}
                             for target in snapshot["observations"]],
            "position_coordinate_system": "internal_map_xy_1000x625",
            "wgs84_order": "longitude, latitude",
            "battery_source": "simulation", "progress_source": "simulation"}
