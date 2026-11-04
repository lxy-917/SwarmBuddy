"""校验导入海域数据与用户指定的经纬度是否对应。"""

import unittest

import main  # noqa: F401 先配置工作区内的 route_planning 导入路径。
from mission_scan import environment_intersects_bounds, inspect_environment_data


class GeoJSONRegionTest(unittest.TestCase):
    def test_imported_polygon_bounds_are_returned_and_unrelated_area_is_rejected(self):
        island = {"type": "Polygon", "coordinates": [[
            [119.7, 25.5], [119.8, 25.5], [119.8, 25.6], [119.7, 25.6], [119.7, 25.5],
        ]]}
        data = {"type": "FeatureCollection", "features": [{
            "type": "Feature", "properties": {"natural": "coastline"}, "geometry": island,
        }]}
        self.assertEqual(inspect_environment_data(data)["bounds"], {
            "west": 119.7, "south": 25.5, "east": 119.8, "north": 25.6,
        })
        self.assertTrue(environment_intersects_bounds(data, 119.72, 25.52, 119.75, 25.56))
        self.assertFalse(environment_intersects_bounds(data, 130, 30, 130.1, 30.1))

    def test_coastline_without_polygon_cannot_be_used_as_an_island(self):
        data = {"type": "FeatureCollection", "features": [{
            "type": "Feature", "properties": {"natural": "coastline"},
            "geometry": {"type": "LineString", "coordinates": [[119.7, 25.5], [119.8, 25.5]]},
        }]}
        with self.assertRaisesRegex(ValueError, "多边形"):
            inspect_environment_data(data)


if __name__ == "__main__":
    unittest.main()
