"""
由于mapping会把Polygon转成普通字典 现在划分区域需要进行几何运算
于是需要把字典变回Polygon
"""
from shapely.geometry import shape, box, mapping

"""
split_search_region(
    search_region=environment["search_region"],
    num_regions=4
)
"""
def split_search_region(
        search_region,
        num_regions
):
    if num_regions < 2:
        raise ValueError("num_regions 必须至少为2")

    # 把字典恢复为Polygon
    polygon = shape(search_region)
    min_x, min_y, max_x, max_y = polygon.bounds

    # 计算宽度
    width = max_x - min_x
    cut_width = width / num_regions

    regions = []

    for i in range(num_regions):
        left = min_x + i * cut_width
        right = min_x + (i+1) * cut_width
        cut_region = box(
            left,
            min_y,
            right,
            max_y
        )

        # 放置切分区域超出搜索区域 取切分区域与搜索区域的交集
        cut_region = polygon.intersection(cut_region)
        regions.append({
            "id": f"region_{i+1}",
            "geometry":mapping(cut_region),
            "area":cut_region.area
        })
    # 封装
    return {
        "success": True,
        "num_regions": len(regions),
        "regions": regions
    }
"""
输出格式为：
{
    'success': True,
    'num_regions': 4,
    'regions': [...]
}
"""
