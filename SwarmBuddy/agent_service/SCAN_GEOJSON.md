# 海域扫描数据格式

在聊天框的回形针菜单中，选择“上传海域数据”可导入 WGS84（EPSG:4326）GeoJSON。坐标顺序为 `[经度, 纬度]`，间距及避障距离的单位为米。示例 `route_planning/data/export.geojson` 只在未导入数据时使用。

可以导入 GeoJSON `FeatureCollection`。多边形默认作为障碍物；在 `properties.role` 中写 `search_region` 可指定唯一的搜索区域，写 `no_go_zone` 可指定禁入区。未指定搜索区域时，使用规划弹窗输入的经纬度边界。

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
