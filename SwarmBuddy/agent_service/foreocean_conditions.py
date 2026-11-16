"""按已保存航迹查询预海天气实况和海浪预报。"""

import json
import math
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from marine_conditions import sample_scan_position


API_ROOT = "https://api.foreocean.com"
TOKEN_FILE = Path(__file__).with_name(".env")


def get_foreocean_token():
    """优先使用进程环境变量，其次读取后端目录的本地 .env。"""
    token = os.environ.get("FOREOCEAN_TOKEN", "").strip()
    if token:
        return token
    try:
        lines = TOKEN_FILE.read_text(encoding="utf-8-sig").splitlines()
    except FileNotFoundError:
        return ""
    for line in lines:
        key, separator, value = line.partition("=")
        if separator and key.strip() == "FOREOCEAN_TOKEN":
            return value.strip().strip('"\'')
    return ""


def _get(path, params, token):
    url = f"{API_ROOT}{path}?{urlencode(params)}"
    request = Request(url, headers={"Token": token, "Accept": "application/json"})
    with urlopen(request, timeout=12) as response:
        if response.status != 200:
            raise RuntimeError("预海天气接口响应异常")
        payload = json.loads(response.read(1_000_000))
    if str(payload.get("code")) != "1000" or payload.get("success") is not True:
        raise RuntimeError(f"预海天气查询失败：{payload.get('msg') or payload.get('code') or '未知错误'}")
    return payload.get("data") or {}


def _number(value, nonnegative=True):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) and (not nonnegative or result >= 0) else None


def fetch_scan_foreocean(scan_result):
    token = get_foreocean_token()
    if not token:
        raise RuntimeError("尚未配置 FOREOCEAN_TOKEN")
    longitude, latitude = sample_scan_position(scan_result)
    location = f"{longitude},{latitude}"
    weather = _get("/weather/realtime", {"location": location, "version": "1.0"}, token)
    wind = _number(weather.get("windSpeed"))
    visibility = _number(weather.get("visibility"))
    temperature = _number(weather.get("temperature"), nonnegative=False)
    if wind is None and visibility is None and temperature is None:
        return {"status": "unavailable", "source": "预海天气", "kind": "天气实况",
                "message": "该位置没有可用的温度、风速或能见度实况"}
    return {"status": "observed", "source": "预海天气", "kind": "天气实况",
            "sample": {"longitude": longitude, "latitude": latitude},
            "observed_at": weather.get("dateTime"), "temperature_c": temperature,
            "wind_speed_ms": wind,
            "visibility_km": visibility}
