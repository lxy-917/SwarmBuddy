from shapely.geometry import box, mapping, shape
import matplotlib.pyplot as plt

from tools.geometry.split_region import split_search_region


# =========================
# 1. 构造测试区域
# =========================

# 构造一个简单的 100 x 100 搜索区域
search_polygon = box(
    0,
    0,
    100,
    100
)

# 模拟 environment["search_region"] 的格式
search_region = mapping(search_polygon)


# =========================
# 2. 划分区域
# =========================

result = split_search_region(
    search_region=search_region,
    num_regions=4
)

print("success:", result["success"])
print("num_regions:", result["num_regions"])


# =========================
# 3. 绘图
# =========================

fig, ax = plt.subplots(figsize=(8, 8))

for region in result["regions"]:

    polygon = shape(region["geometry"])

    # 获取多边形边界坐标
    x, y = polygon.exterior.xy

    # 画区域
    ax.fill(
        x,
        y,
        alpha=0.4
    )

    # 画边界
    ax.plot(
        x,
        y
    )

    # 区域中心
    center = polygon.centroid

    # 标注区域 ID 和面积
    ax.text(
        center.x,
        center.y,
        f'{region["id"]}\narea={region["area"]:.1f}',
        ha="center",
        va="center"
    )


# =========================
# 4. 设置图像
# =========================

ax.set_title("Split Search Region")

ax.set_xlabel("X")
ax.set_ylabel("Y")

ax.set_aspect("equal")

plt.grid(True)

plt.show()