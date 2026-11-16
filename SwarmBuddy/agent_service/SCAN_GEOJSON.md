# 海域扫描数据格式

在聊天框的回形针菜单中，选择“上传海域数据”可导入 WGS84（EPSG:4326）GeoJSON。坐标顺序为 `[经度, 纬度]`，间距及避障距离的单位为米。示例 `route_planning/data/export.geojson` 只在未导入数据时使用。

可以导入 GeoJSON `FeatureCollection`。多边形默认作为障碍物；在 `properties.role` 中写 `search_region` 可指定唯一的搜索区域，写 `no_go_zone` 可指定禁入区。未指定搜索区域时，使用规划弹窗输入的经纬度边界。

海岸线参与规划：示例海图和导入的 `FeatureCollection` 中，`natural=coastline` 或 `role=coastline` 的有向 `LineString` 会与搜索框边界构成陆地面；陆地从 DARP 分区和扫描航线中排除。海岸线须遵循 OpenStreetMap 的方向约定（沿线前进时陆地在左侧），并在搜索框内连续连接；已有的陆地 `Polygon` 也可以直接作为障碍物导入。只有矩形经纬度边界而没有海岸线或陆地多边形时，无法判断哪里是陆地。

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "role": "search_region" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[130, 30], [130.02, 30], [130.02, 30.02], [130, 30.02], [130, 30]]]
      }
    }
  ]
}
```

API 或 `PlanOceanScan` 工具也可以传 `environment_data`，其内容为上述 FeatureCollection，或 `{"search_region": Polygon, "obstacles": [Polygon], "no_go_zones": [Polygon]}`。POST `/mission/scan/{session_id}?agent_id=...` 后，数据按用户、智能体和会话保存；后续工具调用会复用该会话数据。响应中的 `route_geojson` 是 WGS84 航迹，`map` 是仅供界面绘制的相对坐标。

单张普通照片缺少地理坐标和比例尺，不能作为可定位的规划输入。需要有地理配准的多边形数据或先完成配准。
# DARP 多艇分区规划

规划接口默认使用 Python DARP 分区实现，默认 3 艘无人艇。请求可传 `vessel_count`（1–8）。
响应中的 `routes` 包含每艘艇的 `vessel_id`、WGS84 `route_geojson`、航程和分区面积；
`map.routes` 为对应的界面坐标与分区边界。旧字段 `route_geojson` 和 `map.waypoints`
仍指向第一艘艇，仅用于兼容现有的单航线消费者。`path_length_m` 是全队航程之和，
`estimated_duration_hours` 按最长单艇航程估算并行完成时间。

原单艇扫描器保留在 `route_planning/tools/planning/generate_scan_path.py`，规划入口调用已注释。
上游 Java 源码及 MIT 许可见 `route_planning/vendor/mcpp_optimized_darp`；当前 Python 版本
移植了 DARP 分区步骤，尚未移植上游的网格旋转模拟退火与 STC 路线生成。
