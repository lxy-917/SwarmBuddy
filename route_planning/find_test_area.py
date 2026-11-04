"""
用来寻找测试中心
"""

from tools.environment.load_environment import load_environment

from shapely.geometry import shape, box

import random



environment = load_environment(
    geojson_path="data/export.geojson"
)


# 所有岛屿

obstacles = [
    shape(o)
    for o in environment["obstacles"]
]


# 地图范围

search_region = shape(
    environment["search_region"]
)


min_x, min_y, max_x, max_y = search_region.bounds



area_size = 10000   # 10km



for i in range(100):

    center_x = random.uniform(
        min_x,
        max_x
    )

    center_y = random.uniform(
        min_y,
        max_y
    )


    test_region = box(
        center_x-area_size/2,
        center_y-area_size/2,
        center_x+area_size/2,
        center_y+area_size/2
    )


    count = 0


    for obstacle in obstacles:

        if obstacle.intersects(test_region):

            count += 1


    if count > 0:

        print("找到测试区域!")

        print(
            "center_x:",
            center_x
        )

        print(
            "center_y:",
            center_y
        )

        print(
            "岛屿数量:",
            count
        )

        print(
            "bounds:",
            test_region.bounds
        )

        break

else:

    print("100次随机没有找到")