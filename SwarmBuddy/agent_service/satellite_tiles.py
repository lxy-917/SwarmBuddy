"""按 XYZ 坐标读取 Sentinel-2 Cloudless 2024 卫星影像瓦片。"""

from functools import lru_cache
from urllib.request import Request, urlopen


EOX_TILE_URL = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg"
MAX_ZOOM = 14


@lru_cache(maxsize=512)
def get_satellite_tile(z: int, x: int, y: int) -> bytes:
    """只允许服务商公开瓦片金字塔内的数字坐标。"""
    if not (0 <= z <= MAX_ZOOM and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise ValueError("卫星瓦片坐标无效")
    request = Request(
        EOX_TILE_URL.format(z=z, x=x, y=y),
        headers={"User-Agent": "SwarmBuddy/1.0 (academic map viewer)"},
    )
    with urlopen(request, timeout=12) as response:
        if response.status != 200 or "image" not in response.headers.get("Content-Type", ""):
            raise RuntimeError("卫星影像服务未返回图片")
        content = response.read(1_000_001)
    if len(content) > 1_000_000 or not content.startswith(b"\xff\xd8\xff"):
        raise RuntimeError("卫星影像瓦片格式无效")
    return content
