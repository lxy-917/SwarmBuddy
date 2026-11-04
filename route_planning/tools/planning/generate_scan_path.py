from shapely.geometry import shape, LineString, MultiLineString
from route_planning.tools.planning.validate_path import validate_path



"""
    检查两个点之间能否直接连接
    """
def check_connection(
    current,
    target,
    environment
):
    result = validate_path(
        waypoints=[
            current,
            target
        ],
        environment=environment
    )


    return result["valid"]


def normalize_segment(segment):
    """
    保证segment输出格式:
    [
        [left_x, y],
        [right_x, y]
    ]
    """

    p1, p2 = segment


    if p1[0] <= p2[0]:

        return [
            p1,
            p2
        ]

    else:

        return [
            p2,
            p1
        ]

# 排序函数
def sort_segments(
    segments
):

    def segment_key(seg):

        # 计算扫描线片段的高度
        y = (
            seg[0][1]
            +
            seg[1][1]
        ) / 2 

        # 取扫描线片段较小的x
        x = min(
            seg[0][0],
            seg[1][0]
        )

        return y, x #返回(y,x)，sorted会按照优先y，y相同再x的排序方法


    return sorted(
        segments,
        key=segment_key
    )

# 进行分层   把扫描线按照所在的 y 高度分组
def group_segments(
    segments
):

    layers = {}


    for seg in segments:

        y = (
            seg[0][1]
            +
            seg[1][1]
        ) / 2


        if y not in layers:
            layers[y] = []


        layers[y].append(seg)


    return layers


def scan_order_from_waypoints(segments, waypoints, tolerance=0.05):
    """从已保存航迹恢复扫描线顺序，避免优化时重新执行贪心连接。"""
    from math import hypot

    order = []
    visited = set()
    for start, finish in zip(waypoints, waypoints[1:]):
        for index, segment in enumerate(segments):
            if index in visited:
                continue
            for direction in (0, 1):
                entry, exit_point = segment[direction], segment[1 - direction]
                if (hypot(start[0] - entry[0], start[1] - entry[1]) <= tolerance
                        and hypot(finish[0] - exit_point[0], finish[1] - exit_point[1]) <= tolerance):
                    order.append((index, direction))
                    visited.add(index)
                    break
            if index in visited:
                break
    return order if len(order) == len(segments) else None

"""
连接规则：
1:单segment:根据当前扫描方向连接
2:多segment:不能横穿,先连接下一层
示例
segments = [
    [
        (0, 20),
        (100, 20)
    ],
    [
        (200, 20),
        (300, 20)
    ]
]
seg = [
    (0,20),
    (100,20)
]
"""

def connect_segments(layers, environment, start_point=None, end_point=None, return_order=False):
    """每段扫描线访问一次，并贪心选择当前最短的安全连接路径。

    岛礁将扫描线切成左右两段时，逐行连接会反复绕过岛礁。
    优先扫描同侧邻近线段可减少局部绕行，但不保证全局航程最短。
    """
    from math import hypot
    from route_planning.tools.planning.plan_path import plan_path

    remaining = [normalize_segment(segment) for y in sorted(layers) for segment in layers[y]]
    remaining.sort(key=lambda segment: (segment[0][1], segment[0][0]))
    indexed_remaining = list(enumerate(remaining))
    order = []
    if not remaining:
        return ([], []) if return_order else []

    if start_point is None:
        first = remaining.pop(0)
        indexed_remaining.pop(0)
        order.append((0, 0))
        waypoints = [first[0], first[1]]
        current = first[1]
    else:
        current = list(start_point)
        waypoints = [current]

    while remaining:
        candidates = []
        for index, segment in enumerate(remaining):
            for endpoint in (0, 1):
                target = segment[endpoint]
                candidates.append((hypot(current[0] - target[0], current[1] - target[1]), index, endpoint))
        candidates.sort()

        best = None
        for direct_distance, index, endpoint in candidates:
            if best is not None and direct_distance >= best[0] - 1e-9:
                break
            target = remaining[index][endpoint]
            if direct_distance < 1e-9:
                connector, cost = [current], 0.0
            elif check_connection(current, target, environment):
                connector, cost = [current, target], direct_distance
            else:
                detour = plan_path(start=current, goal=target, environment=environment)
                if not detour["success"]:
                    continue
                connector, cost = detour["waypoints"], detour["length"]
            if best is None or cost < best[0]:
                best = (cost, index, endpoint, connector)

        if best is None:
            raise ValueError("Cannot connect the remaining scan segments with a safe route")
        _, index, endpoint, connector = best
        segment = remaining.pop(index)
        segment_index, _ = indexed_remaining.pop(index)
        order.append((segment_index, endpoint))
        for point in connector[1:]:
            if point != waypoints[-1]:
                waypoints.append(point)
        finish = segment[1 - endpoint]
        if finish != waypoints[-1]:
            waypoints.append(finish)
        current = finish

    if end_point is not None:
        from route_planning.tools.planning.plan_path import plan_path
        target = list(end_point)
        if target != waypoints[-1]:
            if check_connection(waypoints[-1], target, environment):
                waypoints.append(target)
            else:
                detour = plan_path(start=waypoints[-1], goal=target, environment=environment)
                if not detour["success"]:
                    raise ValueError("Cannot safely connect the scan route to the destination")
                waypoints.extend(detour["waypoints"][1:])
    return (waypoints, order) if return_order else waypoints


def generate_scan_path(
    search_region,
    spacing, #增量
    obstacles = None,
    obstacle_buffer = 5, #无人机距离岛的安全距离
    environment = None,
    start_point = None,
    end_point = None,
    optimize_route = False,
    baseline_waypoints = None,
):
    obstacles = obstacles or []
    if spacing <= 0:
        raise ValueError("spacing 必须大于 0")
    polygon = shape(search_region)
    free_region = polygon #可航行区域 去除掉岛屿

    for obstacle in obstacles:
        obstacle_polygon = shape(obstacle).buffer(obstacle_buffer) #buffer为缓冲区函数，以这个对象为中心，向外扩张distance

        free_region = free_region.difference(
            obstacle_polygon
        )

    min_x, min_y, max_x, max_y = polygon.bounds

    clipped_lines = [] #扫描线应该控制在搜索区域内

    y = min_y
    # 生成并裁剪扫描线
    while y <= max_y:

        full_line = LineString([
            (min_x, y),
            (max_x, y)
        ])

        clipped = free_region.intersection(full_line) #求扫描线与可航行区的交集

        if clipped.is_empty:
            pass
        elif clipped.geom_type == "LineString": #如果交集是一条线
            clipped_lines.append(clipped)
        elif clipped.geom_type == "MultiLineString": #障碍物把线分开 多条线的情况
            for line in clipped.geoms:
                clipped_lines.append(line)

            

        y += spacing

    # 返回所有线的片段
    segments = []


    for line in clipped_lines:

        coords = list(line.coords)

        segments.append(
            [
                list(coords[0]),
                list(coords[-1])
            ]
        )

    # 排序
    segments = sort_segments(segments)

    # 分层
    layers = group_segments(segments)

    if not segments:
        raise ValueError("搜索区域没有可用的扫描线，请缩小间距或调整区域")

    if optimize_route:
        from route_planning.tools.planning.optimize_scan_route import optimize_scan_route

        initial_order = None
        reused_baseline = False
        if baseline_waypoints is not None and environment is not None:
            initial_order = scan_order_from_waypoints(segments, baseline_waypoints)
            if initial_order is not None:
                waypoints = baseline_waypoints
                reused_baseline = True
        if initial_order is None:
            waypoints, initial_order = connect_segments(
                layers, environment, start_point=start_point, end_point=end_point, return_order=True
            )
        baseline_length = LineString(waypoints).length
        waypoints = optimize_scan_route(
            segments, initial_order, waypoints, environment,
            start_point=start_point, end_point=end_point,
        )
        used_previous_route = reused_baseline and waypoints is baseline_waypoints
    else:
        waypoints = connect_segments(layers, environment, start_point=start_point, end_point=end_point)
        baseline_length = None
        used_previous_route = False


    path = LineString(
        waypoints
    )

    if environment is not None and not used_previous_route and not validate_path(waypoints, environment)["valid"]:
        raise ValueError("生成的航迹未通过越界或障碍校验")


    return {
        "success": True,
        "waypoints": waypoints,
        "segments": segments,
        "layers": layers,
        "length": path.length,
        "baseline_length": baseline_length,
        "used_previous_route": used_previous_route,
    }
