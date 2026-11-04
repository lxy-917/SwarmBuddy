import unittest

from shapely.geometry import box, mapping

from route_planning.tools.planning.generate_scan_path import generate_scan_path
from route_planning.tools.planning.validate_path import validate_path


class ScanSegmentOrderTest(unittest.TestCase):
    def test_split_rows_are_covered_without_repeated_island_detours(self):
        region = box(0, 0, 10_000, 6_000)
        island = box(4_500, 2_000, 6_200, 4_200)
        environment = {
            "search_region": mapping(region),
            "obstacles": [mapping(island.buffer(79.9))],
            "no_go_zones": [],
            "start_points": [],
        }

        result = generate_scan_path(
            search_region=mapping(region),
            spacing=500,
            obstacles=[mapping(island)],
            obstacle_buffer=80,
            environment=environment,
        )

        self.assertEqual(len(result["segments"]), 18)
        self.assertTrue(validate_path(result["waypoints"], environment)["valid"])
        self.assertLess(result["length"], 135_000)

    def test_route_keeps_requested_start_and_finish(self):
        region = box(0, 0, 4_000, 2_000)
        environment = {
            "search_region": mapping(region),
            "obstacles": [],
            "no_go_zones": [],
            "start_points": [],
        }
        result = generate_scan_path(
            search_region=mapping(region), spacing=500,
            environment=environment, start_point=[100, 100], end_point=[3_900, 1_900],
        )
        self.assertEqual(result["waypoints"][0], [100, 100])
        self.assertEqual(result["waypoints"][-1], [3_900, 1_900])
        self.assertTrue(validate_path(result["waypoints"], environment)["valid"])

    def test_optimized_route_preserves_scan_segments_and_safety(self):
        region = box(0, 0, 10_000, 6_000)
        island = box(4_500, 2_000, 6_200, 4_200)
        environment = {
            "search_region": mapping(region),
            "obstacles": [mapping(island.buffer(79.9))],
            "no_go_zones": [],
            "start_points": [],
        }
        options = dict(search_region=mapping(region), spacing=500,
                       obstacles=[mapping(island)], obstacle_buffer=80,
                       environment=environment)
        baseline = generate_scan_path(**options)
        optimized = generate_scan_path(**options, optimize_route=True)
        self.assertEqual(optimized["segments"], baseline["segments"])
        self.assertAlmostEqual(optimized["baseline_length"], baseline["length"])
        self.assertLessEqual(optimized["length"], baseline["length"] + 1e-6)
        self.assertTrue(validate_path(optimized["waypoints"], environment)["valid"])

    def test_optimized_route_can_reduce_distance_with_fixed_destination(self):
        region = box(0, 0, 4_000, 2_000)
        environment = {
            "search_region": mapping(region), "obstacles": [],
            "no_go_zones": [], "start_points": [],
        }
        options = dict(search_region=mapping(region), spacing=500,
                       environment=environment, end_point=[100, 100])
        baseline = generate_scan_path(**options)
        optimized = generate_scan_path(**options, optimize_route=True)
        self.assertLess(optimized["length"], baseline["length"])
        self.assertEqual(optimized["segments"], baseline["segments"])
        self.assertEqual(optimized["waypoints"][-1], [100, 100])
        self.assertTrue(validate_path(optimized["waypoints"], environment)["valid"])

    def test_saved_route_can_be_reused_for_optimization(self):
        region = box(0, 0, 4_000, 2_000)
        environment = {
            "search_region": mapping(region), "obstacles": [],
            "no_go_zones": [], "start_points": [],
        }
        options = dict(search_region=mapping(region), spacing=500,
                       environment=environment, end_point=[100, 100])
        baseline = generate_scan_path(**options)
        optimized = generate_scan_path(
            **options, optimize_route=True,
            baseline_waypoints=baseline["waypoints"],
        )
        self.assertAlmostEqual(optimized["baseline_length"], baseline["length"])
        self.assertLessEqual(optimized["length"], baseline["length"] + 1e-6)
        self.assertTrue(validate_path(optimized["waypoints"], environment)["valid"])


if __name__ == "__main__":
    unittest.main()
