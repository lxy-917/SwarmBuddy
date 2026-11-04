"""
由于GIS数据为经纬度,所以先进行UTM投影
"""

from shapely.ops import transform
from pyproj import Transformer

# 经纬度->UTM米制坐标       
transformer = Transformer.from_crs(
    "EPSG:4326",
    "EPSG:32650",
    always_xy=True
)

def project_geometry(
        geometry
):
    return transform( #遍历一个 Polygon 的所有点，然后调用提供的转换函数
        transformer.transform,
        geometry
    )