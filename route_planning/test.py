from tools.environment.load_environment import load_environment
from tools.planning.generate_scan_path import generate_scan_path
from tools.planning.validate_path import validate_path

from shapely.geometry import shape, box, mapping, LineString
import matplotlib.pyplot as plt
import random



# =====================================
# 1. 加载真实 GeoJSON
# =====================================

environment = load_environment(
    geojson_path="data/export.geojson"
)


print("总障碍物数量:",
      environment["num_obstacles"])



# =====================================
# 2. 设置测试小区域
# =====================================

# 这里选一个区域中心
# 可以后续随机修改

center_x = 776494.533041696
center_y = 2823975.6852273378


area_size = 10000   # 10 km


test_region = box(
    center_x - area_size / 2,
    center_y - area_size / 2,
    center_x + area_size / 2,
    center_y + area_size / 2
)


print("\n测试区域:")
print(test_region.bounds)



# =====================================
# 3. 提取附近障碍物
# =====================================

local_obstacles = []


for obstacle in environment["obstacles"]:

    polygon = shape(obstacle)


    if polygon.intersects(test_region):

        local_obstacles.append(
            obstacle
        )


print(
    "附近障碍物数量:",
    len(local_obstacles)
)



# 如果没有岛，提醒
if len(local_obstacles) == 0:

    print(
        "该区域没有障碍物，请修改center_x,center_y"
    )



# =====================================
# 4. 构造局部环境
# =====================================

local_environment = {

    "success": True,

    "search_region": mapping(
        test_region
    ),

    "obstacles": local_obstacles,

    "no_go_zones": [],

    "start_points": []

}



# =====================================
# 5. 生成扫描路径
# =====================================

scan_result = generate_scan_path(

    search_region=local_environment["search_region"],

    spacing=1000,      # 1km扫描间距

    obstacles=local_environment["obstacles"],

    obstacle_buffer=100,

    environment=local_environment

)



print("\n扫描结果:")

print(
    "waypoints数量:",
    len(scan_result["waypoints"])
)


print(
    "路径长度:",
    scan_result["length"]
)



# =====================================
# 6. 验证路径
# =====================================

validation = validate_path(

    waypoints=scan_result["waypoints"],

    environment=local_environment

)


print("\n路径验证:")

print(validation)



# =====================================
# 7. 可视化
# =====================================

fig, ax = plt.subplots(
    figsize=(8,8)
)



# 搜索区域

region = test_region

x,y = region.exterior.xy

ax.plot(
    x,
    y,
    linewidth=2
)



# 岛屿

for obstacle in local_obstacles:

    island = shape(obstacle)

    x,y = island.exterior.xy

    ax.fill(
        x,
        y,
        alpha=0.5
    )



# 扫描路径

if scan_result["success"]:

    path = LineString(
        scan_result["waypoints"]
    )


    x,y = path.xy


    ax.plot(
        x,
        y,
        marker="."
    )



ax.set_aspect("equal")

ax.set_title(
    "Real Small Area Scan Path"
)


plt.show()