"""验证实测站点的坐标、时效和缺测处理。"""

import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from marine_observations import fetch_scan_observations, parse_ndbc_latest


NOW = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)
ROW = "TEST1 23.450 119.500 2026 10 26 07 00 90 5.0 MM 1.2 8 6.0 MM 1012 MM 25 26 MM 2.0 MM"
SCAN = {
    "bounds": {"west": 119.49, "east": 119.51, "south": 23.44, "north": 23.46},
    "route_geojson": {"coordinates": [[119.49, 23.45], [119.51, 23.45]]},
}


class ObservationTests(unittest.TestCase):
    def test_parses_station_measurements_and_utc(self):
        stations = parse_ndbc_latest("# header\n" + ROW, now=NOW)
        self.assertEqual(len(stations), 1)
        self.assertEqual(stations[0]["observed_at"], "2026-10-26T07:00:00Z")
        self.assertEqual(stations[0]["wave_height_m"], 1.2)
        self.assertEqual(stations[0]["wind_speed_ms"], 5)
        self.assertEqual(stations[0]["visibility_km"], 3.7)

    def test_old_or_missing_observation_is_not_current(self):
        old = ROW.replace("26 07 00", "26 05 00")
        self.assertEqual(parse_ndbc_latest(old, now=NOW), [])
        self.assertEqual(parse_ndbc_latest(ROW.replace("5.0 MM 1.2", "MM MM MM").replace("MM 2.0 MM", "MM MM MM"), now=NOW), [])

    @patch("marine_observations._latest_stations")
    def test_nearest_station_must_be_within_50_km(self, latest):
        latest.return_value = parse_ndbc_latest(ROW, now=NOW)
        self.assertEqual(fetch_scan_observations(SCAN)["status"], "observed")
        far = {**SCAN, "route_geojson": {"coordinates": [[121, 25], [121.01, 25]]}}
        self.assertEqual(fetch_scan_observations(far)["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
