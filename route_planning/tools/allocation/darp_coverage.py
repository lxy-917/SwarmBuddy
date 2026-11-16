"""Python port of the DARP area-assignment stage for maritime coverage.

The upstream Java implementation is retained under route_planning/vendor.  This
module ports its distance-metric assignment, area-balance correction and
connected-component correction.  Routes are generated on the resulting exact
Shapely subregions so that every segment can be checked against the maritime
exclusion geometry.  Grid rotation/shift annealing and STC are not used here.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil, hypot, sqrt

import numpy as np
from scipy import ndimage
from shapely.geometry import LineString, box, mapping
from shapely.ops import unary_union

from route_planning.tools.planning.plan_path import plan_path
from route_planning.tools.planning.validate_path import validate_path


@dataclass
class DarpPlan:
    regions: list
    routes: list[dict]
    scan_lines: list[LineString]
    grid_size_m: float


def _cells(free_region, spacing: float, max_cells: int = 6500):
    min_x, min_y, max_x, max_y = free_region.bounds
    width, height = max_x - min_x, max_y - min_y
    cell_size = max(spacing, sqrt(width * height / max_cells))
    cols, rows = ceil(width / cell_size), ceil(height / cell_size)
    if cols * rows > max_cells:
        cell_size *= sqrt(cols * rows / max_cells) * 1.01
        cols, rows = ceil(width / cell_size), ceil(height / cell_size)
    if cols * rows > max_cells * 1.15:
        raise ValueError("搜索区域过大，请缩小范围或增大扫描间距")
    mask = np.zeros((rows, cols), dtype=bool)
    cell_shapes = {}
    for row in range(rows):
        for col in range(cols):
            tile = box(min_x + col * cell_size, min_y + row * cell_size,
                       min_x + (col + 1) * cell_size, min_y + (row + 1) * cell_size)
            clipped = free_region.intersection(tile)
            if clipped.area > 1e-5:
                mask[row, col] = True
                cell_shapes[row, col] = clipped
    return mask, cell_shapes, cell_size, (min_x, min_y)


def _seeds(mask, count: int, origin, cell_size: float, start_point):
    cells = np.argwhere(mask)
    if len(cells) < count:
        raise ValueError("可航行区域太小，无法分配给指定数量的无人艇")
    coords = cells.astype(float)
    if start_point is not None:
        target = np.array([(start_point[1] - origin[1]) / cell_size - .5,
                           (start_point[0] - origin[0]) / cell_size - .5])
        chosen = [int(np.argmin(np.sum((coords - target) ** 2, axis=1)))]
    else:
        centroid = coords.mean(axis=0)
        chosen = [int(np.argmin(np.sum((coords - centroid) ** 2, axis=1)))]
    while len(chosen) < count:
        distances = np.min(np.stack([np.sum((coords - coords[index]) ** 2, axis=1)
                                     for index in chosen]), axis=0)
        distances[chosen] = -1
        chosen.append(int(np.argmax(distances)))
    return [tuple(map(int, coords[index])) for index in chosen]


def _darp_assign(mask: np.ndarray, seeds: list[tuple[int, int]], portions):
    """DARP metric iteration: balance tile counts and reconnect split regions."""
    count = len(seeds)
    if count == 1:
        return np.where(mask, 0, -1)
    rows, cols = mask.shape
    yy, xx = np.indices(mask.shape)
    distance = np.stack([np.hypot(yy - row, xx - col) + .01 for row, col in seeds])
    metric = distance.copy()
    target = mask.sum() * np.asarray(portions, dtype=float)
    structure = ndimage.generate_binary_structure(2, 1)
    best, best_score = None, float("inf")
    for _ in range(250):
        assignment = np.argmin(metric, axis=0).astype(np.int16)
        assignment[~mask] = -1
        for index, (row, col) in enumerate(seeds):
            assignment[row, col] = index
        counts = np.bincount(assignment[mask], minlength=count)
        split_count = 0
        correction = np.ones_like(metric)
        for index, (row, col) in enumerate(seeds):
            labels, _ = ndimage.label(assignment == index, structure)
            connected = labels == labels[row, col]
            fragments = (assignment == index) & ~connected
            split_count += int(fragments.sum())
            if fragments.any():
                toward_root = ndimage.distance_transform_edt(~connected)
                toward_fragments = ndimage.distance_transform_edt(~fragments)
                delta = toward_root - toward_fragments
                span = max(float(np.max(np.abs(delta))), 1.0)
                correction[index] += .12 * delta / span
        imbalance = float(np.max(np.abs(counts - target) / np.maximum(target, 1)))
        score = imbalance + split_count / mask.sum() * 2
        if score < best_score:
            best, best_score = assignment.copy(), score
        if split_count == 0 and imbalance <= max(.04, 2 / min(target)):
            return assignment
        for index in range(count):
            # The same metric update as DARP: underfilled regions become cheaper.
            factor = float(np.clip(1 + .23 * (counts[index] - target[index]) /
                                   max(target[index], 1), .82, 1.18))
            metric[index] *= factor * np.clip(correction[index], .8, 1.2)
            metric[index] = np.maximum(metric[index], distance[index] * .15)
    if best is None or best_score > .35:
        raise ValueError("DARP 分区未收敛，请调整艇数、扫描间距或搜索区域")
    for index, (row, col) in enumerate(seeds):
        labels, component_count = ndimage.label(best == index, structure)
        if component_count != 1 or labels[row, col] == 0:
            raise ValueError("DARP 未能生成连通分区，请调整艇数、扫描间距或搜索区域")
    return best


def _scan_segments(region, spacing):
    min_x, min_y, max_x, max_y = region.bounds
    y = min_y + spacing / 2
    if y >= max_y:
        y = (min_y + max_y) / 2
    segments = []
    while y < max_y + 1e-7:
        cut = region.intersection(LineString([(min_x - 1, y), (max_x + 1, y)]))
        pieces = [cut] if cut.geom_type == "LineString" else list(getattr(cut, "geoms", []))
        segments.extend(piece for piece in pieces if piece.geom_type == "LineString" and piece.length > 1)
        y += spacing
    return segments


def _connect(start, finish, environment):
    if hypot(start[0] - finish[0], start[1] - finish[1]) < 1e-7:
        return []
    if validate_path([start, finish], environment)["valid"]:
        return [list(finish)]
    alternative = plan_path(start=start, goal=finish, environment=environment)
    if not alternative["success"]:
        raise ValueError("DARP 航段无法安全连接，请调整扫描间距或避障距离")
    return alternative["waypoints"][1:]


def _route(segments, environment, region, start_point, end_point):
    remaining = [tuple(map(tuple, segment.coords)) for segment in segments]
    if not remaining:
        raise ValueError("分区内没有可用扫描线，请缩小扫描间距")
    # GEOS intersections place some scan endpoints a few floating-point ulps
    # outside the polygon; a millimetre tolerance keeps boundary checks stable.
    local_region = region.buffer(.001)
    local_environment = {**environment, "search_region": mapping(local_region)}
    route = []
    ordered = []
    first = min(range(len(remaining)), key=lambda i: (remaining[i][0][1], remaining[i][0][0]))
    line = remaining.pop(first)
    route = [list(line[0]), list(line[-1])]
    ordered.append(LineString(line))
    while remaining:
        current = route[-1]
        candidates = sorted((hypot(current[0] - endpoint[0], current[1] - endpoint[1]), i, direction)
                            for i, line in enumerate(remaining) for direction, endpoint in
                            ((0, line[0]), (1, line[-1])))
        selected = None
        for _, index, direction in candidates:
            line = remaining[index]
            entry, finish = (line[0], line[-1]) if direction == 0 else (line[-1], line[0])
            try:
                connector = _connect(current, entry, local_environment)
            except ValueError:
                continue
            selected = index, connector, finish, line
            break
        if selected is None:
            raise ValueError("DARP 分区中存在无法连接的扫描线")
        index, connector, finish, line = selected
        remaining.pop(index)
        route.extend(connector)
        if list(finish) != route[-1]:
            route.append(list(finish))
        ordered.append(LineString(line))
    if not validate_path(route, local_environment)["valid"]:
        raise ValueError("DARP 分区内航线越界或穿越障碍物")
    if start_point is not None:
        route = [list(start_point), *_connect(start_point, route[0], environment), *route[1:]]
    if end_point is not None:
        route.extend(_connect(route[-1], end_point, environment))
    if not validate_path(route, environment)["valid"]:
        raise ValueError("DARP 航线未通过越界或避障校验")
    return route, ordered


def plan_darp_coverage(search_region, exclusions, spacing: float, environment,
                       vessel_count: int = 3, start_point=None, end_point=None,
                       portions=None) -> DarpPlan:
    """Assign connected grid regions, then build one safe coverage route per USV."""
    if not 1 <= vessel_count <= 8:
        raise ValueError("无人艇数量应在 1 至 8 艘之间")
    if portions is None:
        portions = [1 / vessel_count] * vessel_count
    if len(portions) != vessel_count or any(p <= 0 for p in portions) or abs(sum(portions) - 1) > 1e-6:
        raise ValueError("任务分配比例必须为每艘艇提供正数，且总和为 1")
    blocked = unary_union(exclusions) if exclusions else None
    free = search_region.difference(blocked) if blocked is not None else search_region
    if free.is_empty or free.area <= 0:
        raise ValueError("搜索区内没有可航行区域")
    mask, cell_shapes, cell_size, origin = _cells(free, spacing)
    if vessel_count > len(cell_shapes):
        raise ValueError("可航行区域不足以分配给所有无人艇")
    seeds = _seeds(mask, vessel_count, origin, cell_size, start_point)
    assigned = _darp_assign(mask, seeds, portions)
    regions = []
    routes = []
    scan_lines = []
    for index in range(vessel_count):
        parts = [geometry for (row, col), geometry in cell_shapes.items() if assigned[row, col] == index]
        if not parts:
            raise ValueError("DARP 产生了空分区，请减少无人艇数量")
        region = unary_union(parts)
        segments = _scan_segments(region, spacing)
        waypoints, ordered = _route(segments, environment, region, start_point, end_point)
        regions.append(region)
        scan_lines.extend(ordered)
        routes.append({"vessel_id": f"USV-{index + 1:02d}", "waypoints": waypoints,
                       "scan_lines": ordered, "length_m": LineString(waypoints).length,
                       "region_area_m2": region.area})
    return DarpPlan(regions, routes, scan_lines, cell_size)
