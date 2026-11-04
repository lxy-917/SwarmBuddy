"""海况查询的坐标顺序和网格位置校验。"""

import unittest
from unittest.mock import patch

import marine_conditions


class MarineConditionsTest(unittest.TestCase):
    def setUp(self):
        marine_conditions._fetch_cached.cache_clear()
        self.scan = {"route_geojson": {"type": "LineString", "coordinates": [
            [119.78, 25.65], [119.8, 25.65], [119.82, 25.65],
        ]}}

    def test_sample_uses_geojson_longitude_latitude_order(self):
        self.assertEqual(marine_conditions.sample_scan_position(self.scan), (119.8, 25.65))
        with self.assertRaisesRegex(ValueError, "WGS84"):
            marine_conditions.sample_scan_position({"route_geojson": {"coordinates": [
                [25.65, 119.78], [25.65, 119.8],
            ]}})

    def test_queries_sea_cells_and_converts_visibility(self):
        marine = {"longitude": 119.8, "latitude": 25.65, "current": {
            "time": "2026-10-26T14:00", "wave_height": 1.24, "wave_period": 6.2,
        }}
        weather = {"longitude": 119.81, "latitude": 25.65, "current": {
            "time": "2026-10-26T14:00", "wind_speed_10m": 5.4, "visibility": 12000,
        }}
        with patch.object(marine_conditions, "_get_json", side_effect=[marine, weather]) as request:
            result = marine_conditions.fetch_scan_marine_conditions(self.scan)
        self.assertEqual(result["sample"], {"longitude": 119.8, "latitude": 25.65})
        self.assertEqual(result["visibility_km"], 12.0)
        self.assertEqual(result["wave_height_m"], 1.24)
        self.assertEqual(request.call_args_list[0].args[1]["cell_selection"], "sea")
        self.assertEqual(request.call_args_list[1].args[1]["latitude"], "25.65")

    def test_rejects_distant_forecast_grid(self):
        marine = {"longitude": 121, "latitude": 25.65, "current": {"wave_height": 1.1}}
        weather = {"longitude": 119.8, "latitude": 25.65, "current": {"visibility": 5000}}
        with patch.object(marine_conditions, "_get_json", side_effect=[marine, weather]):
            with self.assertRaisesRegex(RuntimeError, "过远"):
                marine_conditions.fetch_scan_marine_conditions(self.scan)

    def test_large_area_samples_multiple_route_positions(self):
        scan = {"bounds": {"west": 119.5, "south": 25.4, "east": 120, "north": 25.8},
                "route_geojson": {"coordinates": [[119.5, 25.4], [120, 25.4], [120, 25.8]]}}
        positions = marine_conditions.sample_scan_positions(scan)
        self.assertEqual(len(positions), 3)
        marine = [{"longitude": lon, "latitude": lat, "current": {"wave_height": wave, "time": "2026-10-26T14:00"}}
                  for (lon, lat), wave in zip(positions, (0.8, 1.4, 1.1))]
        weather = [{"longitude": lon, "latitude": lat, "current": {"wind_speed_10m": wind, "visibility": visibility}}
                   for (lon, lat), wind, visibility in zip(positions, (2.0, 5.0, 3.0), (12000, 8000, 10000))]
        with patch.object(marine_conditions, "_get_json", side_effect=[marine, weather]) as request:
            result = marine_conditions.fetch_scan_marine_conditions(scan)
        self.assertEqual(result["sample_count"], 3)
        self.assertEqual(result["wave_height_m"], 1.4)
        self.assertEqual(result["wind_speed_ms"], 5.0)
        self.assertEqual(result["visibility_km"], 8.0)
        self.assertIn(",", request.call_args_list[0].args[1]["latitude"])


if __name__ == "__main__":
    unittest.main()
