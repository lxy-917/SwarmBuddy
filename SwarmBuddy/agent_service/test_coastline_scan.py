import unittest

from shapely.geometry import Point, box, mapping, shape
from shapely.ops import unary_union

from mission_scan import _coastline_land, _demo_features, plan_scan


class CoastlineScanTest(unittest.TestCase):
    def test_directed_coastline_excludes_land_on_left(self):
        feature = {"type": "Feature", "properties": {"natural": "coastline"},
                   "geometry": {"type": "LineString", "coordinates": [[5, 10], [5, 0]]}}
        land = _coastline_land([feature], box(0, 0, 10, 10))
        self.assertAlmostEqual(unary_union(land).area, 50)
        self.assertTrue(unary_union(land).covers(Point(8, 5)))
        self.assertFalse(unary_union(land).covers(Point(2, 5)))

    def test_demo_routes_exclude_mainland(self):
        bounds = box(119.68, 25.53, 119.72, 25.57)
        land = unary_union(_coastline_land(_demo_features(), bounds))
        self.assertGreater(land.area / bounds.area, 0.15)
        result = plan_scan(vessel_count=2)
        self.assertEqual(len(result["routes"]), 2)
        self.assertTrue(result["map"]["coastline_land"])
        for route in result["routes"]:
            path = shape(route["route_geojson"])
            self.assertLess(path.intersection(land).length, 1e-8)

    def test_imported_coastline_excludes_city_side(self):
        region = box(130, 30, 130.02, 30.02)
        data = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"role": "search_region"},
             "geometry": mapping(region)},
            {"type": "Feature", "properties": {"natural": "coastline"},
             "geometry": {"type": "LineString",
                          "coordinates": [[130.01, 30.02], [130.01, 30]]}},
        ]}
        result = plan_scan(west=130, south=30, east=130.02, north=30.02,
                           spacing_m=500, vessel_count=2, environment_data=data)
        self.assertEqual(len(result["routes"]), 2)
        self.assertEqual(len(result["map"]["coastline_land"]), 1)
        for route in result["routes"]:
            self.assertLessEqual(max(x for x, _ in route["route_geojson"]["coordinates"]), 130.01000001)


if __name__ == "__main__":
    unittest.main()
