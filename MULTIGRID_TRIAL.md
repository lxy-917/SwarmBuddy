# SwarmBuddy MultiGrid 试验

本试验参考 [MOOS-IvP 05-multigrid](https://github.com/moos-ivp/missions-auto/tree/main/05-multigrid) 中 `pSearchGrid` 汇总多艇位置的思路，在 SwarmBuddy 前端记录仿真无人艇经过各网格的时间。没有复制或运行 MOOS-IvP 源码，DARP 分区与扫描航线保持原样。

## 试用

1. 在海域扫描任务中生成至少两艘艇的 DARP 航线。
2. 点击任务栏的“网格试验”按钮，再展开地图，点击右侧“开始”运行协同仿真。
3. 地图青色格表示有艇经过，橙色格表示至少两艘艇经过；统计卡显示访问格、重叠格和累计艇时。
4. 再次点击“网格试验”关闭并清空记录。重置仿真或重新规划也会清空记录。

网格统计从开启按钮时开始。它反映仿真艇位访问，**不等于传感器有效探测覆盖率**，也不会改变航线或自动重新分区。后续若要接入原版 MOOS-IvP，应将 DARP 航点发给艇端行为，再把 `NODE_REPORT` 与 `VIEW_GRID` 回传 SwarmBuddy；这需要单独安装和运行 MOOS-IvP。
