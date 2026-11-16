"""检查扫描接口及其会话结果持久化。"""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from fastapi.testclient import TestClient

import main
from mission_scan import plan_scan


class MissionScanApiTest(unittest.TestCase):
    def test_chat_coordinates_inside_demo_extent_use_bounds_only(self):
        result = plan_scan(
            west=119.7784, south=25.6440, east=119.8367, north=25.6910,
            spacing_m=350, obstacle_buffer_m=40, speed_knots=3.4,
            start_point=[119.7850, 25.6500], end_point=[119.8300, 25.6850],
            allow_bounds_only=True,
        )
        self.assertEqual(result["source"], "bounds_only")
        self.assertEqual(result["obstacle_count"], 0)
        self.assertEqual(result["route_geojson"]["coordinates"][0], [119.785, 25.65])
        self.assertEqual(result["route_geojson"]["coordinates"][-1], [119.83, 25.685])

    def test_chat_coordinates_do_not_reuse_distant_imported_region(self):
        environment = {"search_region": {"type": "Polygon", "coordinates": [[
            [121.093, 30.094], [121.117, 30.094], [121.117, 30.116],
            [121.093, 30.116], [121.093, 30.094],
        ]]}, "obstacles": [], "no_go_zones": []}
        stored_environment = Mock()
        stored_environment.exists.return_value = True
        stored_environment.read_text.return_value = json.dumps(environment)
        target = Mock()
        request = main.ScanRequest(
            west=119.7783, south=25.644, east=119.8367, north=25.691,
            start_point=[119.785, 25.65], end_point=[119.83, 25.685],
            allow_bounds_only=True, use_requested_bounds=True,
        )
        with patch.object(main, "_environment_file", return_value=stored_environment), \
             patch.object(main, "_scan_file", return_value=target):
            result = asyncio.run(main._save_scan("scan-test", "test-agent", "test-session", request))
        self.assertEqual(result["source"], "bounds_only")
        self.assertEqual(result["route_geojson"]["coordinates"][0], [119.785, 25.65])
        self.assertEqual(result["route_geojson"]["coordinates"][-1], [119.83, 25.685])
        stored_environment.unlink.assert_not_called()

    def test_wide_search_area_has_safe_route(self):
        result = plan_scan(
            west=118.55, south=25.53, east=124.73, north=25.57,
            spacing_m=350, obstacle_buffer_m=40, allow_bounds_only=True,
        )
        self.assertTrue(result["validated"])
        self.assertGreater(result["waypoint_count"], 50)
        self.assertEqual(result["bounds"]["east"], 124.73)

    def test_plan_and_reload_current_session(self):
        workspace = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(dir=workspace) as temporary:
            target = Path(temporary).resolve()
            self.assertTrue(target.is_relative_to(workspace.resolve()))
            with patch.object(main, "SCAN_RESULTS_DIR", target), TestClient(main.app) as client:
                headers = {"X-User-ID": "scan-test"}
                url = "/mission/scan/test-session?agent_id=test-agent"
                self.assertEqual(client.get(url, headers=headers).status_code, 404)
                response = client.post(url, headers=headers, json={})
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                self.assertTrue(result["validated"])
                self.assertGreater(result["waypoint_count"], 2)
                self.assertGreater(result["path_length_m"], 0)
                self.assertEqual(client.get(url, headers=headers).json(), result)
                invalid = client.post(url, headers=headers, json={"spacing_m": 0})
                self.assertEqual(invalid.status_code, 422)
                reversed_bounds = client.post(url, headers=headers, json={"east": 118.72})
                self.assertEqual(reversed_bounds.status_code, 422)
                self.assertIn("边界顺序", reversed_bounds.json()["detail"])
                outside_demo = client.post(url, headers=headers, json={
                    "west": 130, "south": 30, "east": 130.02, "north": 30.02,
                })
                self.assertEqual(outside_demo.status_code, 422)
                self.assertIn("导入真实 GeoJSON", outside_demo.json()["detail"])
                self.assertEqual(client.get(url, headers=headers).json(), result)

    def test_supplied_geojson_is_used_and_reused(self):
        def polygon(west, south, east, north):
            return {"type": "Polygon", "coordinates": [[
                [west, south], [east, south], [east, north],
                [west, north], [west, south],
            ]]}

        environment = {
            "search_region": polygon(130, 30, 130.02, 30.02),
            "obstacles": [polygon(130.009, 30.008, 130.011, 30.012)],
            "no_go_zones": [],
        }
        workspace = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(dir=workspace) as temporary:
            with patch.object(main, "SCAN_RESULTS_DIR", Path(temporary)), TestClient(main.app) as client:
                headers = {"X-User-ID": "real-data-test"}
                url = "/mission/scan/real-session?agent_id=test-agent"
                response = client.post(url, headers=headers, json={
                    "environment_data": environment, "spacing_m": 500,
                    "obstacle_buffer_m": 20,
                })
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                self.assertEqual(result["source"], "provided")
                self.assertEqual(result["bounds"]["west"], 130)
                self.assertEqual(result["obstacle_count"], 1)
                self.assertTrue(result["validated"])
                self.assertEqual(result["route_geojson"]["type"], "LineString")
                self.assertEqual(client.get(url, headers=headers).json(), result)
                repeated = client.post(url, headers=headers, json={"spacing_m": 400})
                self.assertEqual(repeated.status_code, 200, repeated.text)
                self.assertEqual(repeated.json()["source"], "provided")
                demo = client.post(url, headers=headers, json={"use_demo": True})
                self.assertEqual(demo.status_code, 200, demo.text)
                self.assertEqual(demo.json()["source"], "demo")

    def test_imported_surroundings_do_not_expand_requested_scan(self):
        def polygon(west, south, east, north):
            return {"type": "Polygon", "coordinates": [[
                [west, south], [east, south], [east, north],
                [west, north], [west, south],
            ]]}

        environment = {
            "search_region": polygon(129.98, 29.98, 130.04, 30.04),
            "obstacles": [
                polygon(130.009, 30.008, 130.011, 30.012),
                polygon(130.025, 30.008, 130.03, 30.012),
            ],
            "no_go_zones": [],
        }
        result = plan_scan(
            west=130, south=30, east=130.02, north=30.02,
            spacing_m=500, obstacle_buffer_m=20,
            environment_data=environment, use_requested_bounds=True,
        )
        self.assertEqual(result["bounds"], {"west": 130, "south": 30, "east": 130.02, "north": 30.02})
        self.assertEqual(result["obstacle_count"], 1)
        self.assertTrue(result["map"]["context_obstacles"])
        self.assertTrue(all(130 <= longitude <= 130.02 and 30 <= latitude <= 30.02
                            for longitude, latitude in result["route_geojson"]["coordinates"]))

    def test_import_from_composer_saves_current_session_environment(self):
        region = {"type": "Polygon", "coordinates": [[
            [130, 30], [130.02, 30], [130.02, 30.02],
            [130, 30.02], [130, 30],
        ]]}
        data = {"type": "FeatureCollection", "features": [{
            "type": "Feature",
            "properties": {"role": "search_region"},
            "geometry": region,
        }]}
        workspace = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(dir=workspace) as temporary:
            with patch.object(main, "SCAN_RESULTS_DIR", Path(temporary)), TestClient(main.app) as client:
                headers = {"X-User-ID": "import-test"}
                url = "/mission/scan/import-session?agent_id=test-agent"
                env_url = "/mission/scan/import-session/environment?agent_id=test-agent"
                imported = client.post(env_url, headers=headers, json={
                    "filename": "real.geojson", "environment_data": data,
                })
                self.assertEqual(imported.status_code, 200, imported.text)
                self.assertIn("filename", imported.json(), imported.text)
                self.assertEqual(imported.json()["filename"], "real.geojson")
                self.assertEqual(client.get(env_url, headers=headers).json(), imported.json())
                planned = client.post(url, headers=headers, json={"spacing_m": 500})
                self.assertEqual(planned.status_code, 200, planned.text)
                self.assertEqual(planned.json()["bounds"]["west"], 130)
                self.assertEqual(planned.json()["source"], "provided")


class MissionScanReadToolTest(unittest.IsolatedAsyncioTestCase):
    async def test_reads_latest_result_without_mutation_or_cross_session_access(self):
        target = Mock()
        target.exists.return_value = False
        missing_target = Mock()
        missing_target.exists.return_value = False

        def scoped_scan_file(user_id, agent_id, session_id):
            return target if (user_id, agent_id, session_id) == (
                "user-a", "agent-a", "session-a",
            ) else missing_target

        with patch.object(main, "_scan_file", side_effect=scoped_scan_file):
            missing = await main._read_scan_for_agent("user-a", "agent-a", "session-a")
            self.assertEqual(missing["status"], "not_found")

            result = {
                "source": "provided", "validated": True,
                "bounds": {"west": 120, "south": 25, "east": 121, "north": 26},
                "route_type": "往复式扫描", "spacing_m": 350,
                "obstacle_buffer_m": 40, "speed_knots": 3.4,
                "estimated_duration_hours": 2.0, "path_length_m": 12593.6,
                "waypoint_count": 100, "obstacle_count": 2,
                "no_go_zone_count": 1, "planned_coverage_percent": 98.9,
                "covered_area_m2": 38_210_000,
                "target_area_m2": 38_640_000,
                "route_geojson": {"type": "LineString", "coordinates": [
                    [120 + index / 1000, 25.0] for index in range(100)
                ]},
                "map": {"region": [], "obstacles": [], "waypoints": []},
            }
            target.exists.return_value = True
            target.read_text.return_value = json.dumps(result, ensure_ascii=False)

            summary = await main._read_scan_for_agent("user-a", "agent-a", "session-a")
            self.assertEqual(summary["status"], "ready")
            self.assertEqual(summary["uncovered_area_m2"], 430_000)
            self.assertEqual(summary["speed_knots"], 3.4)
            self.assertNotIn("geometry_preview", summary)
            self.assertNotIn("map", summary)
            target.write_text.assert_not_called()
            target.unlink.assert_not_called()
            self.assertEqual(
                (await main._read_scan_for_agent("user-b", "agent-a", "session-a"))["status"],
                "not_found",
            )
            self.assertEqual(
                (await main._read_scan_for_agent("user-a", "agent-a", "session-b"))["status"],
                "not_found",
            )

            preview = await main._read_scan_for_agent(
                "user-a", "agent-a", "session-a", include_geometry=True,
            )
            geometry = preview["geometry_preview"]
            self.assertEqual(geometry["total_waypoints"], 100)
            self.assertEqual(len(geometry["sampled_waypoints"]), 64)
            self.assertEqual(geometry["sampled_waypoints"][0], result["route_geojson"]["coordinates"][0])
            self.assertEqual(geometry["sampled_waypoints"][-1], result["route_geojson"]["coordinates"][-1])
            self.assertTrue(geometry["is_sampled"])

            result["speed_knots"] = 5.0
            target.read_text.return_value = json.dumps(result, ensure_ascii=False)
            updated = await main._read_scan_for_agent("user-a", "agent-a", "session-a")
            self.assertEqual(updated["speed_knots"], 5.0)

    async def test_registered_read_tool_is_read_only(self):
        tools = await main.mission_scan_tools("user-a", "agent-a", "session-a")
        self.assertEqual(tools[0].name, "ReadOceanScanResult")
        self.assertTrue(tools[0].is_read_only)
        with patch.object(main, "_read_scan_for_agent", new=AsyncMock(
            return_value={"status": "ready", "waypoint_count": 79},
        )) as reader:
            response = await tools[0].call(include_geometry=True)
            self.assertIsNotNone(response)
            reader.assert_awaited_once_with(
                "user-a", "agent-a", "session-a", include_geometry=True,
            )


if __name__ == "__main__":
    unittest.main()
