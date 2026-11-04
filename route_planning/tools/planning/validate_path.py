from shapely.geometry import shape, LineString

# 检查“是否越界，碰撞障碍物,禁入区
def validate_path(
    waypoints,
    environment
):
    # 至少需要两个点才能形成路径
    if len(waypoints) < 2:
        raise ValueError("waypoints 至少需要包含两个点")
    
    path = LineString(waypoints)

    search_region = shape(
        environment["search_region"]
    )

    # 是否越界
    inside = search_region.covers(path)

    # 是否碰撞障碍物
    collision = False

    for obstacle_data in environment["obstacles"]:
        obstacle = shape(obstacle_data)

        if path.intersects(obstacle):
            collision = True
            break

    # 是否进入禁区
    no_go_violation = False

    for zone_data in environment["no_go_zones"]:
        zone = shape(zone_data)

        if path.intersects(zone):
            no_go_violation = True
            break

    
    # 综合判断是否合法
    valid = (
        inside
        and not collision
        and not no_go_violation
    )

    return {
        "success": True, #tool执行成功
        "valid": valid,
        "inside_search_region": inside,
        "collision": collision,
        "no_go_violation": no_go_violation,
        "length": path.length
    }


