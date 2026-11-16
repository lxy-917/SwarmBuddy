"""预海天气接入的坐标和实况字段。"""

import unittest
from unittest.mock import patch

from foreocean_conditions import fetch_scan_foreocean, get_foreocean_token


SCAN = {"route_geojson": {"coordinates": [[119.49, 23.45], [119.51, 23.45]]}}


class ForeOceanTests(unittest.TestCase):
    @patch.dict("os.environ", {"FOREOCEAN_TOKEN": ""})
    @patch("foreocean_conditions.TOKEN_FILE")
    def test_reads_local_token_file(self, token_file):
        token_file.read_text.return_value = "# local secret\nFOREOCEAN_TOKEN=abc123\n"
        self.assertEqual(get_foreocean_token(), "abc123")

    @patch.dict("os.environ", {"FOREOCEAN_TOKEN": "test-token"})
    @patch("foreocean_conditions._get")
    def test_weather_fields_from_one_request(self, get):
        get.return_value = {"windSpeed": 6.2, "visibility": 12, "temperature": 18.4,
                            "dateTime": "2026-11-12 10:00"}
        result = fetch_scan_foreocean(SCAN)
        self.assertEqual(result["sample"], {"longitude": 119.5, "latitude": 23.45})
        self.assertEqual(result["wind_speed_ms"], 6.2)
        self.assertEqual(result["temperature_c"], 18.4)
        self.assertEqual(get.call_args.args[1]["location"], "119.5,23.45")
        get.assert_called_once()

    @patch.dict("os.environ", {"FOREOCEAN_TOKEN": "test-token"})
    @patch("foreocean_conditions._get")
    def test_negative_temperature_is_valid(self, get):
        get.return_value = {"windSpeed": 3, "visibility": 8, "temperature": -2.5,
                            "dateTime": "2026-11-12 10:00"}
        result = fetch_scan_foreocean(SCAN)
        self.assertEqual(result["status"], "observed")
        self.assertEqual(result["temperature_c"], -2.5)


if __name__ == "__main__":
    unittest.main()
