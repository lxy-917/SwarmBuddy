"""Checks that the Python DARP port assigns and safely routes a fleet."""

import unittest

from shapely.geometry import LineString, Polygon, box, mapping
from shapely.ops import unary_union

from route_planning.tools.allocation.darp_coverage import plan_darp_coverage
from route_planning.tools.planning.validate_path import validate_path


class DarpCoverageTest(unittest.TestCase):
    def test_three_boats_cover_distinct_navigable_regions(self):
        region = box(0, 0, 3000, 2400)
        island = box(1250, 900, 1550, 1450)
        blocked = island.buffer(40)
        environment = {
            "search_region": mapping(region),
            "obstacles": [mapping(island.buffer(39.9))],
            "no_go_zones": [],
        }
        plan = plan_darp_coverage(region, [blocked], 250, environment, vessel_count=3)
        self.assertEqual(len(plan.routes), 3)
        self.assertLess(region.difference(blocked).symmetric_difference(unary_union(plan.regions)).area, 0.01)
        for index, route in enumerate(plan.routes):
            self.assertEqual(route["vessel_id"], f"USV-{index + 1:02d}")
            self.assertTrue(validate_path(route["waypoints"], environment)["valid"])
            self.assertTrue(plan.regions[index].buffer(.001).covers(
                LineString(route["waypoints"])),
                f"{route['vessel_id']} crossed its assigned DARP region")
            self.assertGreater(route["length_m"], 0)
            for other in plan.regions[index + 1:]:
                self.assertLess(plan.regions[index].intersection(other).area, 0.01)

    def test_shared_base_is_preserved_on_each_route(self):
        region = box(0, 0, 1500, 1200)
        environment = {"search_region": mapping(region), "obstacles": [], "no_go_zones": []}
        start, finish = [100, 100], [1400, 1100]
        plan = plan_darp_coverage(region, [], 200, environment, vessel_count=2,
                                  start_point=start, end_point=finish)
        for route in plan.routes:
            self.assertEqual(route["waypoints"][0], start)
            self.assertEqual(route["waypoints"][-1], finish)

    def test_concave_partition_connectors_stay_inside_region(self):
        region = Polygon([(0, 0), (1000, 0), (1000, 250),
                          (350, 250), (350, 1000), (0, 1000)])
        environment = {"search_region": mapping(region), "obstacles": [], "no_go_zones": []}
        plan = plan_darp_coverage(region, [], 150, environment, vessel_count=1)
        self.assertTrue(region.buffer(.001).covers(LineString(plan.routes[0]["waypoints"])))


if __name__ == "__main__":
    unittest.main()
