from shapely.geometry import box, mapping, shape
import matplotlib.pyplot as plt

from tools.planning.generate_scan_path import generate_scan_path


def test_generate_scan_path():

    # ==========================================
    # 1. 创建搜索区域
    # ==========================================

    # 300 x 200 的搜索区域
    search_polygon = box(
        0,
        0,
        300,
        200
    )


    # ==========================================
    # 2. 创建较大的障碍物
    # ==========================================

    # 障碍物1：
    # x: 60 ~ 120
    # y: 40 ~ 160
    obstacle_1 = box(
        60,
        40,
        120,
        160
    )

    # 障碍物2：
    # x: 170 ~ 240
    # y: 80 ~ 190
    obstacle_2 = box(
        170,
        80,
        240,
        190
    )


    obstacles = [
        mapping(obstacle_1),
        mapping(obstacle_2)
    ]


    # ==========================================
    # 3. 构造 environment
    # ==========================================

    environment = {
        "search_region": mapping(search_polygon),

        "obstacles": obstacles,

        "no_go_zones": [],

        "start_points": []
    }


    # ==========================================
    # 4. 生成扫描路径
    # ==========================================

    result = generate_scan_path(
        search_region=environment["search_region"],
        spacing=20,
        obstacles=environment["obstacles"],
        obstacle_buffer=5,
        environment=environment
    )


    print("success:", result["success"])
    print("waypoints 数量:", len(result["waypoints"]))
    print("segments 数量:", len(result["segments"]))
    print("路径长度:", result["length"])


    # ==========================================
    # 5. 绘图
    # ==========================================

    fig, ax = plt.subplots(
        figsize=(12, 8)
    )


    # ------------------------------------------
    # 搜索区域
    # ------------------------------------------

    polygon = shape(
        environment["search_region"]
    )

    x, y = polygon.exterior.xy

    ax.plot(
        x,
        y,
        linewidth=2,
        label="Search Region"
    )


    # ------------------------------------------
    # 障碍物
    # ------------------------------------------

    for i, obstacle in enumerate(
        environment["obstacles"]
    ):

        obstacle_polygon = shape(obstacle)

        x, y = obstacle_polygon.exterior.xy

        ax.fill(
            x,
            y,
            alpha=0.5,
            label=f"Obstacle {i + 1}"
        )


    # ------------------------------------------
    # 原始扫描线 segments
    # ------------------------------------------

    for segment in result["segments"]:

        x = [
            segment[0][0],
            segment[1][0]
        ]

        y = [
            segment[0][1],
            segment[1][1]
        ]

        ax.plot(
            x,
            y,
            linestyle="--",
            linewidth=1
        )


    # ------------------------------------------
    # 最终连接后的扫描路径
    # ------------------------------------------

    waypoints = result["waypoints"]

    path_x = [
        point[0]
        for point in waypoints
    ]

    path_y = [
        point[1]
        for point in waypoints
    ]

    ax.plot(
        path_x,
        path_y,
        marker="o",
        markersize=3,
        linewidth=2,
        label="Final Path"
    )


    # ------------------------------------------
    # 起点终点
    # ------------------------------------------

    if len(waypoints) > 0:

        ax.scatter(
            waypoints[0][0],
            waypoints[0][1],
            s=100,
            label="Start"
        )

        ax.scatter(
            waypoints[-1][0],
            waypoints[-1][1],
            s=100,
            label="End"
        )


    # ==========================================
    # 6. 图像设置
    # ==========================================

    ax.set_title(
        "Scan Path With Large Obstacles"
    )

    ax.set_xlabel("X")
    ax.set_ylabel("Y")

    ax.set_aspect("equal")

    ax.grid(True)

    ax.legend()

    plt.show()


if __name__ == "__main__":

    test_generate_scan_path()