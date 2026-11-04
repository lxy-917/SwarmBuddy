"""
处理原始GIS文件,输出Environment

V0.1
暂时定义Polygon中的岛屿为obstalce,暂时忽略海岸线(LineString)
search_region为整个GeoJSON的Bounding Box:
118.5557348 ~ 124.7284085
21.7582891 ~ 26.05055
"""
import json
from shapely.geometry import shape,box
from route_planning.tools.environment.coordinate import project_geometry
from shapely.geometry import mapping

# 读取 GeoJSON，并提取 Polygon
def load_geojson_environment(
        geojson_path
):
    # 读取文件
    with open(
        geojson_path,
        "r",
        encoding="utf-8"
    ) as f:
        data = json.load(f)

    obstacles = []
    # feature 为一个地理对象 岛屿，障碍之类
    all_geometries = []

    # 遍历所有feature
    for feature in data["features"]:
        gemoetry = feature["geometry"]

        geom = shape(gemoetry) # 转换geometry格式

        # 投影
        geom = project_geometry(
            geom
        )
        all_geometries.append(geom)

        # 只保留Polygon
        if geom.geom_type == "Polygon":
            obstacles.append(geom)

    print("提取Polygon数量:",len(obstacles))
    min_x = min(
        g.bounds[0]
        for g in all_geometries
    )

    min_y = min(
        g.bounds[1]
        for g in all_geometries
    )


    max_x = max(
        g.bounds[2]
        for g in all_geometries
    )

    max_y = max(
        g.bounds[3]
        for g in all_geometries
    )
    search_region = box(
        min_x,
        min_y,
        max_x,
        max_y
    )
    
    return {

        "success": True,

        "search_region": mapping(
            search_region
        ),

        "obstacles": [
            mapping(obstacle)
            for obstacle in obstacles
        ],

        "no_go_zones": [],

        "start_points": [],

        "num_obstacles": len(obstacles)

}
