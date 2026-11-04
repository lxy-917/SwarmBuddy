"""在不删除扫描线的前提下，优化扫描顺序和每段的行进方向。"""

from functools import lru_cache
from heapq import heappop, heappush
from math import hypot
from time import monotonic

from shapely.geometry import LineString, Point, shape
from shapely.ops import unary_union
from shapely.prepared import prep

from route_planning.tools.planning.validate_path import validate_path


class _GridConnector:
    """复用同一张安全网格，为多个候选连接快速寻找绕行。"""

    def __init__(self, environment):
        self.environment = environment
        region = shape(environment["search_region"])
        blocked = [shape(item) for item in environment["obstacles"] + environment["no_go_zones"]]
        free = region.difference(unary_union(blocked)) if blocked else region
        self.free = prep(free)
        min_x, min_y, max_x, max_y = region.bounds
        self.step = max(40.0, (max_x - min_x) / 75, (max_y - min_y) / 75)
        self.origin = (min_x, min_y)
        self.nodes = {}
        columns = int((max_x - min_x) / self.step)
        rows = int((max_y - min_y) / self.step)
        if (columns + 1) * (rows + 1) > 10000:
            return
        for x in range(columns + 1):
            for y in range(rows + 1):
                point = (min_x + x * self.step, min_y + y * self.step)
                if free.contains(Point(point)):
                    self.nodes[(x, y)] = point

    def _nearby(self, point):
        ix = round((point[0] - self.origin[0]) / self.step)
        iy = round((point[1] - self.origin[1]) / self.step)
        options = []
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                cell = (ix + dx, iy + dy)
                target = self.nodes.get(cell)
                if target is not None and self.free.covers(LineString([point, target])):
                    options.append((hypot(point[0] - target[0], point[1] - target[1]), cell))
        return sorted(options)[:8]

    def connect(self, source, target, deadline):
        if not self.nodes:
            return (), float("inf")
        starts = self._nearby(source)
        goals = {cell: distance for distance, cell in self._nearby(target)}
        if not starts or not goals:
            return (), float("inf")
        frontier, costs, previous = [], {}, {}
        for cost, cell in starts:
            costs[cell] = cost
            previous[cell] = None
            point = self.nodes[cell]
            heappush(frontier, (cost + hypot(point[0] - target[0], point[1] - target[1]), cost, cell))
        found = None
        while frontier and monotonic() < deadline:
            _, cost, cell = heappop(frontier)
            if cost > costs.get(cell, float("inf")) + 1e-9:
                continue
            if cell in goals:
                found = cell
                break
            a = self.nodes[cell]
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1),
                           (-1, -1), (-1, 1), (1, -1), (1, 1)):
                neighbor = (cell[0] + dx, cell[1] + dy)
                b = self.nodes.get(neighbor)
                if b is None:
                    continue
                distance = hypot(a[0] - b[0], a[1] - b[1])
                next_cost = cost + distance
                if next_cost >= costs.get(neighbor, float("inf")):
                    continue
                if not self.free.covers(LineString([a, b])):
                    continue
                costs[neighbor] = next_cost
                previous[neighbor] = cell
                heappush(frontier, (next_cost + hypot(b[0] - target[0], b[1] - target[1]), next_cost, neighbor))
        if found is None:
            return (), float("inf")
        cells = []
        while found is not None:
            cells.append(self.nodes[found])
            found = previous[found]
        path = [source, *reversed(cells), target]
        # 删除网格造成的多余折点，同时保持每条捷径都在可通行区域内。
        simplified = [path[0]]
        index = 0
        while index < len(path) - 1:
            next_index = len(path) - 1
            while next_index > index + 1 and not self.free.covers(LineString([path[index], path[next_index]])):
                next_index -= 1
            simplified.append(path[next_index])
            index = next_index
        length = LineString(simplified).length
        if not validate_path(simplified, self.environment)["valid"]:
            return (), float("inf")
        return tuple(simplified), length


def optimize_scan_route(segments, initial_order, initial_waypoints, environment,
                        start_point=None, end_point=None, time_limit_s=12.0):
    """返回更短的合法航迹；找不到改进时保留原航迹。

    order 中的 (编号, 方向) 表示必须完整走过的扫描线。只改变其顺序和方向，
    因而扫描线集合及由其计算的覆盖率不会变化。
    """
    if len(initial_order) < 2 or environment is None:
        return initial_waypoints

    deadline = monotonic() + time_limit_s
    grid = None
    baseline_length = LineString(initial_waypoints).length
    scan_length = sum(LineString(segment).length for segment in segments)

    def entry(state):
        index, direction = state
        return tuple(segments[index][direction])

    def exit_point(state):
        index, direction = state
        return tuple(segments[index][1 - direction])

    # 原航线中的绕行已经完成安全校验，直接复用其连接路径与长度。
    original_connections = {}
    positions = []
    cursor = 0
    for state in initial_order:
        start, finish = entry(state), exit_point(state)
        for position in range(cursor, len(initial_waypoints) - 1):
            if (hypot(initial_waypoints[position][0] - start[0],
                      initial_waypoints[position][1] - start[1]) < 0.05
                    and hypot(initial_waypoints[position + 1][0] - finish[0],
                              initial_waypoints[position + 1][1] - finish[1]) < 0.05):
                positions.append((position, position + 1))
                cursor = position + 1
                break
    if len(positions) == len(initial_order):
        def remember(source, target, points):
            path = [source, *[tuple(point) for point in points[1:-1]], target]
            original_connections[(source, target)] = (
                tuple(path), LineString(path).length if len(path) > 1 else 0.0,
            )

        if start_point is not None:
            remember(tuple(start_point), entry(initial_order[0]),
                     initial_waypoints[:positions[0][0] + 1])
        for left, right, previous, current in zip(
                positions, positions[1:], initial_order, initial_order[1:]):
            remember(exit_point(previous), entry(current),
                     initial_waypoints[left[1]:right[0] + 1])
        if end_point is not None:
            remember(exit_point(initial_order[-1]), tuple(end_point),
                     initial_waypoints[positions[-1][1]:])

    @lru_cache(maxsize=12000)
    def connector(source, target):
        nonlocal grid
        if (source, target) in original_connections:
            return original_connections[(source, target)]
        if source == target:
            return (source,), 0.0
        direct = hypot(source[0] - target[0], source[1] - target[1])
        if validate_path([source, target], environment)["valid"]:
            return (source, target), direct
        if monotonic() >= deadline:
            return (), float("inf")
        if grid is None:
            grid = _GridConnector(environment)
        return grid.connect(source, target, deadline)

    def route_cost(order):
        cost = scan_length
        if start_point is not None:
            cost += connector(tuple(start_point), entry(order[0]))[1]
        for previous, current in zip(order, order[1:]):
            cost += connector(exit_point(previous), entry(current))[1]
        if end_point is not None:
            cost += connector(exit_point(order[-1]), tuple(end_point))[1]
        return cost

    def build_waypoints(order):
        points = [list(start_point)] if start_point is not None else [list(entry(order[0]))]
        for state in order:
            path, _ = connector(tuple(points[-1]), entry(state))
            if not path:
                return None
            points.extend(list(point) for point in path[1:])
            finish = list(exit_point(state))
            if points[-1] != finish:
                points.append(finish)
        if end_point is not None:
            path, _ = connector(tuple(points[-1]), tuple(end_point))
            if not path:
                return None
            points.extend(list(point) for point in path[1:])
        return points

    order = list(initial_order)
    best_cost = baseline_length
    # 固定扫描线顺序时，用动态规划同时选择所有线段的行进方向。
    scores = [float("inf"), float("inf")]
    parents = []
    completed = True
    for position, (segment_index, _) in enumerate(order):
        if monotonic() >= deadline:
            completed = False
            break
        next_scores = [float("inf"), float("inf")]
        next_parents = [None, None]
        for direction in (0, 1):
            state = (segment_index, direction)
            if position == 0:
                next_scores[direction] = (
                    connector(tuple(start_point), entry(state))[1]
                    if start_point is not None else 0.0
                )
            else:
                for previous_direction in (0, 1):
                    previous_state = (order[position - 1][0], previous_direction)
                    cost = scores[previous_direction] + connector(
                        exit_point(previous_state), entry(state)
                    )[1]
                    if cost < next_scores[direction]:
                        next_scores[direction] = cost
                        next_parents[direction] = previous_direction
        scores = next_scores
        parents.append(next_parents)
    if completed:
        endings = [
            scores[direction] + (
                connector(exit_point((order[-1][0], direction)), tuple(end_point))[1]
                if end_point is not None else 0.0
            ) for direction in (0, 1)
        ]
        direction = min((0, 1), key=lambda value: endings[value])
        if scan_length + endings[direction] < best_cost - 1e-6:
            directions = [direction]
            for position in range(len(order) - 1, 0, -1):
                direction = parents[position][direction]
                directions.append(direction)
            directions.reverse()
            order = [(state[0], direction) for state, direction in zip(order, directions)]
            best_cost = scan_length + min(endings)
    # 逐步扩大交换范围；每次接受改进后重新检查新的扫描顺序。
    for _ in range(40):
        improved = False
        for i in range(len(order)):
            if monotonic() >= deadline:
                break
            candidates = []
            flipped = order.copy()
            flipped[i] = (flipped[i][0], 1 - flipped[i][1])
            candidates.append(flipped)
            for j in range(len(order)):
                if i == j:
                    continue
                moved = order.copy()
                state = moved.pop(i)
                moved.insert(j, state)
                candidates.append(moved)
                if j > i:
                    reversed_block = order.copy()
                    reversed_block[i:j + 1] = [
                        (index, 1 - direction)
                        for index, direction in reversed(order[i:j + 1])
                    ]
                    candidates.append(reversed_block)
            for candidate in candidates:
                if monotonic() >= deadline:
                    break
                candidate_cost = route_cost(candidate)
                if candidate_cost + 1e-6 < best_cost:
                    order, best_cost = candidate, candidate_cost
                    improved = True
                    break
            if improved:
                break
        if not improved:
            break

    if best_cost >= baseline_length - 1e-6:
        return initial_waypoints
    result = build_waypoints(order)
    if result is None or len(result) < 2:
        return initial_waypoints
    if LineString(result).length >= baseline_length - 1e-6:
        return initial_waypoints
    return result if validate_path(result, environment)["valid"] else initial_waypoints
