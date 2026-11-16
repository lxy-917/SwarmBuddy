"""将 WGS84 GeoJSON 转换为航线规划工具所需数据，并序列化规划结果。"""
from functools import lru_cache
import json
import math
from pathlib import Path

from shapely import transform
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import polygonize, unary_union
# Legacy implementation is retained below, but the DARP port is active.
# from route_planning.tools.planning.generate_scan_path import generate_scan_path
from route_planning.tools.allocation.darp_coverage import plan_darp_coverage

DATA_FILE = Path(__file__).resolve().parents[2] / "route_planning" / "data" / "export.geojson"
EARTH_RADIUS_M = 6_371_000


@lru_cache(maxsize=1)
def _demo_features():
    with DATA_FILE.open(encoding="utf-8") as stream:
        return json.load(stream)["features"]


def _coastline_land(features, search_region):
    """Turn directed OSM coastlines into land polygons inside a scan window.

    Coastline direction places land to the left. The scan-window boundary closes
    open coastal arcs, while closed island polygons remain separate obstacles.
    """
    coastlines = []
    for feature in features:
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        if (geometry.get("type") != "LineString"
                or (properties.get("natural") != "coastline"
                    and properties.get("role") != "coastline")):
            continue
        line = shape(geometry)
        if line.intersects(search_region):
            clipped = line.intersection(search_region)
            coastlines.extend(part for part in (
                [clipped] if clipped.geom_type == "LineString" else getattr(clipped, "geoms", []))
                if part.geom_type == "LineString" and part.length > 0)
    if not coastlines:
        return []

    faces = list(polygonize(unary_union([search_region.boundary, *coastlines])))
    if not faces:
        raise ValueError("示例海岸线无法构成陆地边界，请导入包含陆地多边形的 GeoJSON")
    epsilon = min(search_region.bounds[2] - search_region.bounds[0],
                  search_region.bounds[3] - search_region.bounds[1]) * 0.00002
    land_faces = set()
    for line in coastlines:
        coordinates = list(line.coords)
        for (x1, y1), (x2, y2) in zip(coordinates, coordinates[1:]):
            dx, dy = x2 - x1, y2 - y1
            distance = math.hypot(dx, dy)
            if distance <= 1e-12:
                continue
            left = Point((x1 + x2) / 2 - dy / distance * epsilon,
                         (y1 + y2) / 2 + dx / distance * epsilon)
            for index, face in enumerate(faces):
                if face.covers(left):
                    land_faces.add(index)
                    break
    return [face for index, face in enumerate(faces) if index in land_faces]


def _polygon(value, label):
    if isinstance(value, dict) and value.get("type") == "Feature":
        value = value.get("geometry")
    if not isinstance(value, dict) or value.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError(f"{label} 必须是 GeoJSON Polygon 或 MultiPolygon")
    try:
        geometry = shape(value)
    except (TypeError, ValueError, KeyError) as exc:
        raise ValueError(f"{label} 坐标无效") from exc
    if geometry.is_empty or not geometry.is_valid or geometry.area <= 0:
        raise ValueError(f"{label} 必须是有效且非空的多边形")
    return geometry


def _parse_environment(data, default_region):
    if data is None:
        return default_region, [], []
    if not isinstance(data, dict):
        raise ValueError("GeoJSON 顶层必须是对象")
    if data.get("type") == "FeatureCollection":
        features = data.get("features")
        if not isinstance(features, list) or len(features) > 10000:
            raise ValueError("GeoJSON 要包含不超过 10000 个要素")
        regions, obstacles, zones = [], [], []
        for feature in features:
            if not isinstance(feature, dict) or feature.get("type") != "Feature":
                raise ValueError("FeatureCollection 包含无效要素")
            raw = feature.get("geometry")
            if not isinstance(raw, dict) or raw.get("type") not in ("Polygon", "MultiPolygon"):
                continue
            geometry = _polygon(raw, "GeoJSON 要素")
            role = str((feature.get("properties") or {}).get("role", "obstacle")).lower()
            if role in ("search_region", "region", "area_of_interest"):
                regions.append(geometry)
            elif role in ("no_go_zone", "no_go", "restricted"):
                zones.append(geometry)
            else:
                obstacles.append(geometry)
        if len(regions) > 1:
            raise ValueError("只能标记一个 search_region")
        return (regions[0] if regions else default_region), obstacles, zones
    if "search_region" in data:
        obstacles, zones = data.get("obstacles", []), data.get("no_go_zones", [])
        if not isinstance(obstacles, list) or not isinstance(zones, list) or len(obstacles) + len(zones) > 10000:
            raise ValueError("障碍物和禁入区合计不得超过 10000 个")
        return (_polygon(data["search_region"], "search_region"),
                [_polygon(x, "obstacle") for x in obstacles],
                [_polygon(x, "no_go_zone") for x in zones])
    raise ValueError("请提供 FeatureCollection 或包含 search_region 的对象")


def inspect_environment_data(data):
    """在保存到会话前校验用户提供的海域数据。"""
    region, obstacles, zones = _parse_environment(data, None)
    geometries = ([region] if region is not None else []) + obstacles + zones
    if not geometries:
        raise ValueError("GeoJSON 未包含可用于扫描的多边形；海岸线 LineString 需要先构成陆地面")
    for geometry in geometries:
        west, south, east, north = geometry.bounds
        if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
            raise ValueError("GeoJSON 坐标超出 WGS84 范围")
    source_bounds = region.bounds if region is not None else (
        min(geometry.bounds[0] for geometry in geometries),
        min(geometry.bounds[1] for geometry in geometries),
        max(geometry.bounds[2] for geometry in geometries),
        max(geometry.bounds[3] for geometry in geometries),
    )
    return {"has_search_region": region is not None,
            "obstacle_count": len(obstacles), "no_go_zone_count": len(zones),
            "bounds": dict(zip(("west", "south", "east", "north"), source_bounds))}


def environment_intersects_bounds(data, west, south, east, north):
    """拒绝与导入数据空间范围完全无关的扫描坐标。"""
    region, obstacles, zones = _parse_environment(data, None)
    if region is not None:
        return region.intersects(box(west, south, east, north))
    polygons = obstacles + zones
    if not polygons:
        return False
    source_bounds = (
        min(geometry.bounds[0] for geometry in polygons),
        min(geometry.bounds[1] for geometry in polygons),
        max(geometry.bounds[2] for geometry in polygons),
        max(geometry.bounds[3] for geometry in polygons),
    )
    return box(*source_bounds).intersects(box(west, south, east, north))


def _rings(geometry, to_map):
    def polygons_of(item):
        if item.geom_type == "Polygon":
            yield item
        elif hasattr(item, "geoms"):
            for part in item.geoms:
                yield from polygons_of(part)

    polygons = polygons_of(geometry)
    return [[to_map(x, y) for x, y in polygon.exterior.coords]
            for polygon in polygons if not polygon.is_empty]


def plan_scan(west=119.68, south=25.53, east=119.72, north=25.57,
              spacing_m=350, obstacle_buffer_m=40, environment_data=None,
              speed_knots=None, start_point=None, end_point=None,
              use_requested_bounds=False, allow_bounds_only=False,
              optimize_route=False, previous_result=None, vessel_count=3):
    """优先使用用户提供的几何数据；未提供时才使用示例地图。"""
    if optimize_route:
        raise ValueError("DARP 多艇方案的二次航线优化尚未移植")
    if not all(math.isfinite(x) for x in (west, south, east, north, spacing_m, obstacle_buffer_m)):
        raise ValueError("所有数值必须是有限数字")
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("经纬度超出 WGS84 范围，或边界顺序有误")
    if not 30 <= spacing_m <= 2000:
        raise ValueError("扫描间距应在 30 至 2000 米之间")
    if not 0 <= obstacle_buffer_m <= 500:
        raise ValueError("避障距离应在 0 至 500 米之间")
    if speed_knots is not None and (not math.isfinite(speed_knots) or speed_knots <= 0):
        raise ValueError("预计航速必须是大于 0 的有限数字")
    in_demo_region = 118.5 <= west < east <= 124.8 and 21.7 <= south < north <= 26.1
    if environment_data is None and not in_demo_region and not allow_bounds_only:
        raise ValueError("该区域不在示例海图内，请先导入真实 GeoJSON 海域数据")

    geo_region, geo_obstacles, geo_zones = _parse_environment(
        environment_data, box(west, south, east, north))
    if use_requested_bounds and environment_data is not None:
        geo_region = geo_region.intersection(box(west, south, east, north))
        if geo_region.is_empty or geo_region.area <= 0:
            raise ValueError("指定的经纬度范围与已导入海域不相交")
    west, south, east, north = geo_region.bounds
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("搜索区域的经纬度超出 WGS84 范围")
    center_lat, center_lon = (north + south) / 2, (east + west) / 2
    metres_lon = EARTH_RADIUS_M * math.cos(math.radians(center_lat)) * math.pi / 180
    metres_lat = EARTH_RADIUS_M * math.pi / 180

    def project(x, y, z=None):
        return ((x - center_lon) * metres_lon, (y - center_lat) * metres_lat)

    region = transform(geo_region, project, interleaved=False)
    geo_coastline_land = []
    if environment_data is None and not allow_bounds_only:
        geo_obstacles = []
        demo_features = _demo_features()
        for feature in demo_features:
            raw = feature.get("geometry")
            if isinstance(raw, dict) and raw.get("type") in ("Polygon", "MultiPolygon"):
                geometry = shape(raw)
                if geometry.intersects(geo_region):
                    geo_obstacles.append(geometry)
        geo_coastline_land = _coastline_land(demo_features, geo_region)
    elif environment_data is not None and environment_data.get("type") == "FeatureCollection":
        geo_coastline_land = _coastline_land(environment_data.get("features", []), geo_region)

    def clipped(items):
        result = []
        for geometry in items:
            if geometry.intersects(geo_region):
                part = transform(geometry.intersection(geo_region), project, interleaved=False)
                if not part.is_empty and part.area > 1:
                    result.append(part)
        if len(result) > 200:
            raise ValueError("区域内障碍物或禁入区超过 200 个，请缩小区域")
        return result

    obstacles, zones = clipped(geo_obstacles), clipped(geo_zones)
    coastline_land = clipped(geo_coastline_land)
    exclusions = obstacles + zones + coastline_land
    def checked_point(coordinates, label):
        if coordinates is None:
            return None
        if (not isinstance(coordinates, (list, tuple)) or len(coordinates) != 2
                or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in coordinates)):
            raise ValueError(f"{label}需要提供有效的经度和纬度")
        lon, lat = coordinates
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError(f"{label}经纬度超出 WGS84 范围")
        projected = list(project(lon, lat))
        point = Point(projected)
        if not region.covers(point):
            raise ValueError(f"{label}不在当前扫描区域内，请调整经纬度范围")
        if any(point.intersects(item.buffer(obstacle_buffer_m)) for item in exclusions):
            raise ValueError(f"{label}位于障碍物或禁入区缓冲范围内，请更换位置")
        return projected

    projected_start = checked_point(start_point, "起点")
    projected_end = checked_point(end_point, "终点")
    # 连接路径与扫描线裁剪使用相同的避障距离；微小容差避免缓冲区边界误判为碰撞。
    checked_buffer = max(0, obstacle_buffer_m - 0.1)
    environment = {"search_region": mapping(region),
                   "obstacles": [mapping(x.buffer(checked_buffer)) for x in obstacles + coastline_land],
                   "no_go_zones": [mapping(x.buffer(checked_buffer)) for x in zones],
                   "start_points": []}
    # Original scan-planner invocation is retained for later comparison.
    # baseline_waypoints = None
    # if optimize_route and previous_result is not None:
    #     coordinates = previous_result.get("route_geojson", {}).get("coordinates", [])
    #     if len(coordinates) >= 2:
    #         baseline_waypoints = [list(project(lon, lat)) for lon, lat in coordinates]
    # raw = generate_scan_path(
    #     search_region=environment["search_region"], spacing=spacing_m,
    #     obstacles=[mapping(x) for x in exclusions],
    #     obstacle_buffer=obstacle_buffer_m, environment=environment,
    #     start_point=projected_start, end_point=projected_end,
    #     optimize_route=optimize_route, baseline_waypoints=baseline_waypoints)
    # scan_segment_length = sum(LineString(segment).length for segment in raw["segments"])
    # if raw["used_previous_route"] and previous_result is not None:
    #     # 已保存结果在生成时通过安全校验；经纬度序列化的微小误差不应触发全量重算。
    #     return {
    #         **previous_result,
    #         "route_optimized": True,
    #         "baseline_path_length_m": previous_result.get("baseline_path_length_m")
    #         or previous_result["path_length_m"],
    #         "scan_segment_length_m": round(scan_segment_length, 1),
    #     }
    # if not validate_path(raw["waypoints"], environment)["valid"]:
    #     raise ValueError("生成的航迹未通过安全校验")

    del previous_result
    blocked = [item.buffer(obstacle_buffer_m) for item in exclusions]
    darp = plan_darp_coverage(
        search_region=region, exclusions=blocked, spacing=spacing_m,
        environment=environment, vessel_count=vessel_count,
        start_point=projected_start, end_point=projected_end,
    )
    scan_segment_length = sum(line.length for line in darp.scan_lines)

    buffered = unary_union(blocked) if blocked else None
    navigable = region.difference(buffered) if buffered is not None else region
    scan_lines = darp.scan_lines
    covered = navigable.intersection(
        unary_union([line.buffer(spacing_m / 2, cap_style="flat") for line in scan_lines]))
    min_x, min_y, max_x, max_y = region.bounds
    scale = min(900 / (max_x - min_x), 525 / (max_y - min_y))

    def to_map(x, y):
        return [round(500 + (x - (min_x + max_x) / 2) * scale, 2),
                round(312.5 - (y - (min_y + max_y) / 2) * scale, 2)]

    def to_geo(x, y):
        return [round(center_lon + x / metres_lon, 8),
                round(center_lat + y / metres_lat, 8)]

    # 导入文件中位于扫描框外的岛屿只用于地图背景；规划与覆盖率仍只用用户指定的区域。
    context_obstacles = []
    if environment_data is not None:
        longitude_margin = max(east - west, 0.002)
        latitude_margin = max(north - south, 0.002)
        context_area = box(west - longitude_margin, south - latitude_margin,
                           east + longitude_margin, north + latitude_margin)
        for geometry in geo_obstacles:
            if not geometry.intersects(context_area):
                continue
            outside_region = geometry.intersection(context_area).difference(geo_region)
            if outside_region.is_empty:
                continue
            projected = transform(outside_region, project, interleaved=False)
            context_obstacles.extend(_rings(projected.simplify(3, preserve_topology=True), to_map))
            if len(context_obstacles) >= 250:
                context_obstacles = context_obstacles[:250]
                break

    routes = [
        {
            "vessel_id": item["vessel_id"],
            "route_geojson": {"type": "LineString", "coordinates": [to_geo(*p) for p in item["waypoints"]]},
            "path_length_m": round(item["length_m"], 1),
            "region_area_m2": round(item["region_area_m2"]),
            "waypoint_count": len(item["waypoints"]),
        }
        for item in darp.routes
    ]
    total_length = sum(item["length_m"] for item in darp.routes)
    longest_route = max(item["length_m"] for item in darp.routes)
    return {
        "bounds": {"west": west, "south": south, "east": east, "north": north},
        "source": "provided" if environment_data is not None else "bounds_only" if allow_bounds_only else "demo",
        "planner": "darp_python",
        "planner_revision": 2,
        "vessel_count": vessel_count,
        "grid_size_m": round(darp.grid_size_m, 1),
        "spacing_m": spacing_m, "obstacle_buffer_m": obstacle_buffer_m,
        "speed_knots": speed_knots,
        "start_point": list(start_point) if start_point is not None else None,
        "end_point": list(end_point) if end_point is not None else None,
        "estimated_duration_hours": round(longest_route / (speed_knots * 1852), 4) if speed_knots is not None else None,
        "path_length_m": round(total_length, 1),
        "scan_segment_length_m": round(scan_segment_length, 1),
        "baseline_path_length_m": None,
        "route_optimized": False,
        "waypoint_count": sum(len(item["waypoints"]) for item in darp.routes),
        "obstacle_count": len(obstacles) + len(coastline_land), "no_go_zone_count": len(zones),
        "planned_coverage_percent": round(100 * covered.area / navigable.area, 1) if navigable.area else 0,
        "covered_area_m2": round(covered.area), "target_area_m2": round(navigable.area),
        "route_type": "DARP 多艇分区扫描", "validated": True,
        "route_geojson": routes[0]["route_geojson"],
        "routes": routes,
        "map": {"region": _rings(region, to_map),
                "obstacles": [ring for x in obstacles for ring in _rings(x, to_map)],
                "coastline_land": [ring for x in coastline_land for ring in _rings(x, to_map)],
                "context_obstacles": context_obstacles,
                "no_go_zones": [ring for x in zones for ring in _rings(x, to_map)],
                "waypoints": [to_map(*p) for p in darp.routes[0]["waypoints"]],
                "routes": [{"vessel_id": item["vessel_id"],
                            "waypoints": [to_map(*p) for p in item["waypoints"]],
                            "region": _rings(part, to_map)}
                           for item, part in zip(darp.routes, darp.regions)]},
    }
