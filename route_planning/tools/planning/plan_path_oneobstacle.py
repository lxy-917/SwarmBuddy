"""
初版，直线路径规划，仅支持一个障碍物规避
"""
from shapely.geometry import LineString, shape
from route_planning.tools.planning.validate_path import validate_path


def plan_path(
    start,
    goal,
    environment,
    clearance = 5 #绕行距离
):

    # 先尝试直接从起点走到终点
    waypoints = [
        start,
        goal
    ]

    # 检查这条直线路径是否合法
    validation = validate_path(
        waypoints=waypoints,
        environment=environment
    )

    if validation["valid"]:

        path = LineString(waypoints)

        return {
            "success": True,
            "waypoints": waypoints,
            "length": path.length,
            "method": "direct"
        }

    # 直线失败，绕行
    obstacle_data = environment["obstacles"][0] 
    obstacle = shape(obstacle_data)

    min_x,min_y,max_x,max_y = obstacle.bounds

    bottom_left = (
    min_x - clearance,
    min_y - clearance
)

    bottom_right = (
        max_x + clearance,
        min_y - clearance
    )

    top_left = (
        min_x - clearance,
        max_y + clearance
    )

    top_right = (
        max_x + clearance,
        max_y + clearance
    )

    # 下方候选路径
    bottom_waypoints = [
        start,
        bottom_left,
        bottom_right,
        goal
    ]


    # 上方候选路径
    top_waypoints = [
        start,
        top_left,
        top_right,
        goal
    ]

    # 检查两条路径是否合法
    bottom_validation = validate_path(
        waypoints=bottom_waypoints,
        environment=environment
    )

    top_validation = validate_path(
        waypoints=top_waypoints,
        environment=environment
    )

    print("bottom path:", bottom_waypoints)
    print("bottom validation:", bottom_validation)

    print("top path:", top_waypoints)
    print("top validation:", top_validation)


    # 两条路线都合法
    if bottom_validation["valid"] and top_validation["valid"]:

        if bottom_validation["length"] <= top_validation["length"]:
            best_waypoints = bottom_waypoints
            best_validation = bottom_validation
            method = "detour_bottom"

        else:
            best_waypoints = top_waypoints
            best_validation = top_validation
            method = "detour_top"

        return {
            "success": True,
            "waypoints": best_waypoints,
            "length": best_validation["length"],
            "method": method
        }
    # 只有下方合法
    if bottom_validation["valid"]:

        return {
            "success": True,
            "waypoints": bottom_waypoints,
            "length": bottom_validation["length"],
            "method": "detour_bottom"
        }
    # 只有上方合法
    if top_validation["valid"]:

        return {
            "success": True,
            "waypoints": top_waypoints,
            "length": top_validation["length"],
            "method": "detour_top"
        }
    # 都不可行
    return {
    "success": False,
    "waypoints": [],
    "length": None,
    "method": "detour",
    "reason": "没有找到合法绕行路径"
}
