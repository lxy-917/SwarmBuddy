import networkx as nx
import heapq
import math

from shapely.geometry import shape, Point, LineString
from shapely.ops import unary_union
from shapely.prepared import prep

from route_planning.tools.planning.validate_path import validate_path


def plan_path(
    start,
    goal,
    environment,
    clearance=5
):
    # ==========================================
    # 1. 参数检查
    # ==========================================

    if len(start) != 2:
        raise ValueError("start 必须是二维坐标")

    if len(goal) != 2:
        raise ValueError("goal 必须是二维坐标")

    if clearance < 0:
        raise ValueError("clearance 不能小于 0")

    # 内部统一使用 tuple
    start = tuple(start)
    goal = tuple(goal)


    # ==========================================
    # 2. 优先尝试直线路径
    # ==========================================

    direct_validation = validate_path(
        waypoints=[start, goal],
        environment=environment
    )

    if direct_validation["valid"]:

        return {
            "success": True,
            "waypoints": [
                list(start),
                list(goal)
            ],
            "length": direct_validation["length"],
            "method": "direct"
        }


    # ==========================================
    # 3. 收集 Visibility Graph 候选节点
    # ==========================================

    nodes = [
        start,
        goal
    ]

    blocked_areas = (
        environment["obstacles"]
        + environment["no_go_zones"]
    )
    # 只考虑连接线附近的几何障碍，控制可视图的搜索规模。
    corridor = LineString([start, goal])
    margin = max(150.0, min(2000.0, corridor.length))
    blocked_areas = [
        area_data for area_data in blocked_areas
        if shape(area_data).distance(corridor) <= margin
    ]

    for area_data in blocked_areas:

        area = shape(area_data)

        min_x, min_y, max_x, max_y = area.bounds

        candidates = [
            (
                min_x - clearance,
                min_y - clearance
            ),
            (
                max_x + clearance,
                min_y - clearance
            ),
            (
                min_x - clearance,
                max_y + clearance
            ),
            (
                max_x + clearance,
                max_y + clearance
            )
        ]

        for point in candidates:

            if point_is_usable(
                point,
                environment
            ):

                if point not in nodes:
                    nodes.append(point)


    # ==========================================
    # 4. 创建 Visibility Graph
    # ==========================================

    graph = nx.Graph()

    for node in nodes:
        graph.add_node(node)


    # ==========================================
    # 5. 任意两个节点之间检查能否直线通过
    # ==========================================

    for i in range(len(nodes)):

        for j in range(i + 1, len(nodes)):

            point_a = nodes[i]
            point_b = nodes[j]

            validation = validate_path(
                waypoints=[
                    point_a,
                    point_b
                ],
                environment=environment
            )

            if validation["valid"]:

                graph.add_edge(
                    point_a,
                    point_b,
                    weight=validation["length"]
                )


    # ==========================================
    # 6. Dijkstra 找最短路径
    # ==========================================

    try:

        shortest_path = nx.shortest_path(
            graph,
            source=start,
            target=goal,
            weight="weight"
        )

    except nx.NetworkXNoPath:
        detour = _grid_detour(start, goal, environment)
        if detour is not None:
            return {
                "success": True,
                "waypoints": detour,
                "length": LineString(detour).length,
                "method": "local_grid",
            }
        return {
            "success": False,
            "waypoints": [],
            "length": None,
            "method": "visibility_graph",
            "reason": "没有找到合法路径"
        }


    # ==========================================
    # 7. 计算最终路径长度
    # ==========================================

    path = LineString(shortest_path)


    # ==========================================
    # 8. 标准化返回
    # ==========================================

    return {
        "success": True,
        "waypoints": [
            list(point)
            for point in shortest_path
        ],
        "length": path.length,
        "method": "visibility_graph"
    }


def _grid_detour(start, goal, environment):
    """障碍物包围盒节点无法穿过狭窄通道时，改用网格搜索。"""
    region = shape(environment["search_region"])
    blocked = [shape(item) for item in environment["obstacles"] + environment["no_go_zones"]]
    direct = LineString([start, goal])
    blockers = [item for item in blocked if item.intersects(direct)]
    if not blockers and region.covers(direct):
        return None
    blocked_union = unary_union(blocked)
    free = prep(region.difference(blocked_union))
    bounds = [direct.bounds, *[item.bounds for item in blockers]]
    margin = max(150.0, min(2000.0, direct.length))
    min_x = max(region.bounds[0], min(item[0] for item in bounds) - margin)
    min_y = max(region.bounds[1], min(item[1] for item in bounds) - margin)
    max_x = min(region.bounds[2], max(item[2] for item in bounds) + margin)
    max_y = min(region.bounds[3], max(item[3] for item in bounds) + margin)
    if max_x <= min_x or max_y <= min_y:
        return None

    for step in (50.0, 25.0):
        columns = math.ceil((max_x - min_x) / step)
        rows = math.ceil((max_y - min_y) / step)
        if columns * rows > 30000:
            continue
        points = {}
        for ix in range(columns + 1):
            for iy in range(rows + 1):
                point = (min_x + ix * step, min_y + iy * step)
                if free.covers(Point(point)):
                    points[(ix, iy)] = point
        if not points:
            continue
        start_cells = []
        for cell, point in points.items():
            if math.dist(start, point) <= step * 2 and free.covers(LineString([start, point])):
                start_cells.append((math.dist(start, point), cell))
        if not start_cells:
            continue
        frontier = []
        previous = {}
        best = {}
        for distance, cell in start_cells:
            best[cell] = distance
            previous[cell] = None
            heapq.heappush(frontier, (distance + math.dist(points[cell], goal), distance, cell))
        visited = set()
        found = None
        while frontier:
            _, cost, cell = heapq.heappop(frontier)
            if cell in visited:
                continue
            visited.add(cell)
            point = points[cell]
            if math.dist(point, goal) <= step * 2 and free.covers(LineString([point, goal])):
                found = cell
                break
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1),
                           (1, 1), (1, -1), (-1, 1), (-1, -1)):
                neighbor = (cell[0] + dx, cell[1] + dy)
                target = points.get(neighbor)
                if target is None or neighbor in visited:
                    continue
                if not free.covers(LineString([point, target])):
                    continue
                tentative = cost + math.dist(point, target)
                if tentative < best.get(neighbor, math.inf):
                    best[neighbor] = tentative
                    previous[neighbor] = cell
                    heapq.heappush(frontier, (tentative + math.dist(target, goal), tentative, neighbor))
        if found is not None:
            middle = []
            while found is not None:
                middle.append(points[found])
                found = previous[found]
            path = [list(start)] + [list(point) for point in reversed(middle)] + [list(goal)]
            if validate_path(path, environment)["valid"]:
                return path
    return None


def point_is_usable(
    point,
    environment
):
    point = Point(point)

    search_region = shape(
        environment["search_region"]
    )

    # 必须位于搜索区域内
    if not search_region.covers(point):
        return False

    # 不能位于障碍物内
    for obstacle_data in environment["obstacles"]:

        obstacle = shape(obstacle_data)

        if obstacle.covers(point):
            return False

    # 不能位于禁区内
    for zone_data in environment["no_go_zones"]:

        zone = shape(zone_data)

        if zone.covers(point):
            return False

    return True
