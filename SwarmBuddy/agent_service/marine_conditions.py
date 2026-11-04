"""根据规划航迹中的 WGS84 坐标获取海况与海上天气预报。"""

import json
import math
import time
from functools import lru_cache
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from shapely.geometry import LineString


MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
MAX_GRID_DISTANCE_KM = 20


def sample_scan_position(scan_result):
    """从有效航迹取中点，避免矩形中心落在岛礁或多边形洞内。"""
    route = scan_result.get("route_geojson") or {}
    coordinates = route.get("coordinates") or []
    if len(coordinates) < 2:
        raise ValueError("当前航迹缺少可用于查询海况的坐标")
    for point in coordinates:
        if (not isinstance(point, (list, tuple)) or len(point) < 2
                or not all(isinstance(value, (int, float)) and math.isfinite(value)
                           for value in point[:2])
                or not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90)):
            raise ValueError("航迹坐标不是有效的 WGS84 [经度, 纬度]")
    line = LineString([(point[0], point[1]) for point in coordinates])
    if line.is_empty or line.length <= 0:
        raise ValueError("当前航迹无法确定海况查询位置")
    point = line.interpolate(0.5, normalized=True)
    return round(point.x, 6), round(point.y, 6)


def sample_scan_positions(scan_result):
    """海域跨度超过 20 公里时，沿已校验航迹取三个分散的采样点。"""
    center = sample_scan_position(scan_result)
    bounds = scan_result.get("bounds") or {}
    try:
        diagonal_km = _distance_km(
            (bounds["west"], bounds["south"]), (bounds["east"], bounds["north"]),
        )
    except (KeyError, TypeError, ValueError):
        diagonal_km = 0
    if diagonal_km <= 20:
        return (center,)
    line = LineString([tuple(point[:2]) for point in scan_result["route_geojson"]["coordinates"]])
    points = [line.interpolate(fraction, normalized=True) for fraction in (0.12, 0.5, 0.88)]
    return tuple(dict.fromkeys((round(point.x, 6), round(point.y, 6)) for point in points))


def _get_json(base_url, params):
    request = Request(
        f"{base_url}?{urlencode(params)}",
        headers={"User-Agent": "SwarmBuddy/1.0"},
    )
    with urlopen(request, timeout=12) as response:
        if response.status != 200:
            raise RuntimeError("海况数据源响应异常")
        payload = response.read(512_000)
    data = json.loads(payload)
    if not isinstance(data, (dict, list)) or (isinstance(data, dict) and data.get("error")):
        raise RuntimeError("海况数据源未返回有效结果")
    return data


def _distance_km(first, second):
    lon1, lat1 = map(math.radians, first)
    lon2, lat2 = map(math.radians, second)
    delta_lon, delta_lat = lon2 - lon1, lat2 - lat1
    arc = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(arc)))


def _number(data, key):
    value = (data.get("current") or {}).get(key)
    return round(float(value), 2) if isinstance(value, (int, float)) and math.isfinite(value) else None


@lru_cache(maxsize=256)
def _fetch_cached(positions, time_slot):
    """十五分钟内复用同一组采样点的模式预报。"""
    common = {
        "latitude": ",".join(str(latitude) for _, latitude in positions),
        "longitude": ",".join(str(longitude) for longitude, _ in positions),
        "timezone": "auto", "cell_selection": "sea",
    }
    marine_response = _get_json(MARINE_URL, {**common, "current": "wave_height,wave_period"})
    weather_response = _get_json(WEATHER_URL, {**common, "current": "wind_speed_10m,visibility", "wind_speed_unit": "ms"})
    marine = marine_response if isinstance(marine_response, list) else [marine_response]
    weather = weather_response if isinstance(weather_response, list) else [weather_response]
    if len(marine) != len(positions) or len(weather) != len(positions):
        raise RuntimeError("海况数据源返回的采样点数量不匹配")

    grids = [[], []]
    for index, results in enumerate((marine, weather)):
        for requested, result in zip(positions, results):
            if not isinstance(result, dict) or result.get("error"):
                raise RuntimeError("海况数据源未返回有效结果")
            grid = (result.get("longitude"), result.get("latitude"))
            if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in grid):
                raise RuntimeError("海况数据源未返回有效网格坐标")
            distance = _distance_km(requested, grid)
            if distance > MAX_GRID_DISTANCE_KM:
                raise RuntimeError("预报网格距离扫描航迹过远，已停止展示")
            grids[index].append({"longitude": grid[0], "latitude": grid[1], "distance_km": round(distance, 1)})

    def values(results, key):
        return [value for result in results if (value := _number(result, key)) is not None]

    wave_heights = values(marine, "wave_height")
    wave_periods = values(marine, "wave_period")
    winds = values(weather, "wind_speed_10m")
    visibilities = values(weather, "visibility")
    if not wave_heights and not winds and not visibilities:
        raise RuntimeError("当前海域没有可用的海况预报数值")
    longitude, latitude = positions[len(positions) // 2]
    return {
        "source": "Open-Meteo",
        "kind": "模式预报",
        "sample_count": len(positions),
        "samples": [{"longitude": lon, "latitude": lat} for lon, lat in positions],
        "sample": {"longitude": longitude, "latitude": latitude},
        "marine_grid": max(grids[0], key=lambda grid: grid["distance_km"]),
        "weather_grid": max(grids[1], key=lambda grid: grid["distance_km"]),
        "marine_time": (marine[0].get("current") or {}).get("time"),
        "weather_time": (weather[0].get("current") or {}).get("time"),
        "wave_height_m": max(wave_heights) if wave_heights else None,
        "wave_period_s": max(wave_periods) if wave_periods else None,
        "visibility_km": round(min(visibilities) / 1000, 1) if visibilities else None,
        "wind_speed_ms": max(winds) if winds else None,
    }


def fetch_scan_marine_conditions(scan_result):
    positions = sample_scan_positions(scan_result)
    return _fetch_cached(positions, int(time.time() // 900))
