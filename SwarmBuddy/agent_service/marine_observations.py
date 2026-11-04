"""读取附近浮标的近实时实测值，不用模式预报填补缺失观测。"""

from datetime import datetime, timezone
from functools import lru_cache
import math
import time
from urllib.request import Request, urlopen

from shapely.geometry import LineString, Point
from shapely.ops import nearest_points

from marine_conditions import _distance_km, sample_scan_position


NDBC_LATEST_URL = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
MAX_STATION_DISTANCE_KM = 50
MAX_OBSERVATION_AGE_SECONDS = 2 * 60 * 60


def _measurement(raw):
    if raw == "MM":
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def parse_ndbc_latest(payload, now=None):
    """解析 NDBC 的 latest_obs.txt；缺测字段保留为空。"""
    now = now or datetime.now(timezone.utc)
    stations = []
    for line in payload.splitlines():
        if not line or line.startswith("#"):
            continue
        cells = line.split()
        if len(cells) < 22:
            continue
        try:
            station_id = cells[0]
            latitude, longitude = float(cells[1]), float(cells[2])
            observed_at = datetime(*map(int, cells[3:8]), tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
        age = (now - observed_at).total_seconds()
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180
                and 0 <= age <= MAX_OBSERVATION_AGE_SECONDS):
            continue
        wind = _measurement(cells[9])
        wave = _measurement(cells[11])
        period = _measurement(cells[13])
        visibility_nmi = _measurement(cells[20])
        if all(value is None for value in (wind, wave, visibility_nmi)):
            continue
        stations.append({
            "id": station_id,
            "latitude": latitude,
            "longitude": longitude,
            "observed_at": observed_at.isoformat().replace("+00:00", "Z"),
            "wave_height_m": wave,
            "wave_period_s": period,
            "wind_speed_ms": wind,
            "visibility_km": round(visibility_nmi * 1.852, 2) if visibility_nmi is not None else None,
        })
    return stations


@lru_cache(maxsize=2)
def _latest_stations(time_slot):
    request = Request(NDBC_LATEST_URL, headers={"User-Agent": "SwarmBuddy/1.0"})
    with urlopen(request, timeout=12) as response:
        if response.status != 200:
            raise RuntimeError("浮标观测数据源响应异常")
        payload = response.read(400_000).decode("utf-8", errors="replace")
    return parse_ndbc_latest(payload)


def fetch_scan_observations(scan_result):
    """只返回距扫描航迹 50 公里内、两小时内的站点实测。"""
    sample_scan_position(scan_result)  # 先完整校验航迹的 WGS84 坐标。
    coordinates = scan_result["route_geojson"]["coordinates"]
    stations = _latest_stations(int(time.time() // 300))
    candidates = []
    for station in stations:
        # 将经度按站点纬度缩放，再求整段航迹上的最近位置；不会漏掉两次采样点之间的站。
        latitude_scale = max(0.01, math.cos(math.radians(station["latitude"])))
        line = LineString([(longitude * latitude_scale, latitude) for longitude, latitude in coordinates])
        nearest, _ = nearest_points(line, Point(station["longitude"] * latitude_scale, station["latitude"]))
        distance = _distance_km(
            (nearest.x / latitude_scale, nearest.y),
            (station["longitude"], station["latitude"]),
        )
        if distance <= MAX_STATION_DISTANCE_KM:
            candidates.append((distance, station))
    if not candidates:
        return {
            "status": "unavailable", "source": "NOAA NDBC", "kind": "站点实测",
            "message": "扫描航迹 50 公里内没有两小时内的可用浮标观测",
            "search_radius_km": MAX_STATION_DISTANCE_KM,
        }
    distance, station = min(candidates, key=lambda candidate: candidate[0])
    return {
        "status": "observed", "source": "NOAA NDBC", "kind": "站点实测",
        "station": {"id": station["id"], "longitude": station["longitude"],
                    "latitude": station["latitude"], "distance_km": round(distance, 1)},
        "observed_at": station["observed_at"],
        "wave_height_m": station["wave_height_m"],
        "wave_period_s": station["wave_period_s"],
        "wind_speed_ms": station["wind_speed_ms"],
        "visibility_km": station["visibility_km"],
    }
