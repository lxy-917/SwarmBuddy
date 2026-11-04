from shapely.geometry import Polygon, Point, mapping

#支持两种输入 1 手动输入 2真实地图
def load_environment(
        search_region = None, # 传入二维坐标点的list
        obstacles = None,
        no_go_zones = None,
        start_points = None,
        geojson_path=None 
        #加一个目标位置的坐标
):
    if geojson_path is not None:

        from route_planning.tools.environment.load_geojson_environment import (
            load_geojson_environment
        )

        return load_geojson_environment(
            geojson_path
        )
    obstacles = obstacles or [] # 传回来的障碍物之类的数量不确定，所以使用list
    no_go_zones = no_go_zones or []
    start_points = start_points or []

    search_region = Polygon(search_region)
    if not search_region.is_valid:
        raise ValueError("搜索区域不是合法的 Polygon")

    obstacles_polygons = []
    for obstacle in obstacles:
        polygon = Polygon(obstacle)

        if not polygon.is_valid:
            raise ValueError("存在不合法的障碍物 Polygon")

        obstacles_polygons.append(polygon)

    no_go_polygons = []
    for zone in no_go_zones:
        polygon = Polygon(zone)

        if not polygon.is_valid:
            raise ValueError("存在不合法的禁入区 Polygon")

        no_go_polygons.append(polygon)

    for start in start_points:
        point = Point(start)

        # 起点必须在搜索区域中
        if not search_region.covers(point):
            raise ValueError(
                f"起点 {start} 不在搜索区域内"
            )

        # 起点不能在障碍物中
        for obstacle in obstacles_polygons:
            if obstacle.covers(point):
                raise ValueError(
                    f"起点{start}位于障碍物中"
                )

        # 起点不能在no go zones中
        for zone in no_go_polygons:
            if zone.covers(point):
                raise ValueError(
                    f"起点{start}位于禁区中"
                )
            

    environment = {
    "success": True,

    "search_region": mapping(search_region),

    "obstacles": [
        mapping(polygon)
        for polygon in obstacles_polygons
    ],

    "no_go_zones": [
        mapping(polygon)
        for polygon in no_go_polygons
    ],

    "start_points": [
        list(point)
        for point in start_points
    ],

    "area": search_region.area,

    "bounds": list(search_region.bounds),

    "num_obstacles": len(obstacles_polygons),

    "num_no_go_zones": len(no_go_polygons)
}
    return environment
