# SwarmBuddy

SwarmBuddy 是面向海域搜索与巡检的智能辅助平台。当前原型支持导入 GeoJSON 海域数据、生成多艇分区扫描航线、查看地图结果，以及通过对话分析方案。海空协同等功能仍在开发和仿真验证中。

## 项目结构

| 目录 | 用途 |
| --- | --- |
| `SwarmBuddy/agent_service/` | Python 后端、海域扫描接口及相关服务 |
| `SwarmBuddy/web_ui/frontend/` | React 前端 |
| `SwarmBuddy/web_ui/backend/` | 前端工程附带的 Node 服务，当前主要提供开发接口 |
| `route_planning/` | 海域环境处理和扫描航线规划算法 |
| `src/agentscope/` | 项目使用的 AgentScope 2.0 本地源码 |
| `Start-SwarmBuddy.ps1` | 原开发机启动脚本，含本机 Memurai 安装路径；新电脑建议先按下述步骤手动启动 |

## 任务页代码位置

| 文件 | 职责 |
| --- | --- |
| `SwarmBuddy/web_ui/frontend/src/pages/mission/MissionPage.tsx` | 会话、任务状态和地图交互的页面编排 |
| `missionChatBridge.ts`、`missionChatActions.ts` | 地图对象定位、仿真快照和规划操作的结构化回执 |
| `missionFleet.ts`、`missionCooperationSimulation.ts` | 前端艇机仿真状态及推进 |
| `MissionScanMap.tsx`、`MissionSituationAside.tsx` | 地图与右侧任务状态视图 |
| `SwarmBuddy/agent_service/main.py` | 聊天工具和扫描任务 API |
| `mission_chat_state.py`、`mission_task_agents.py` | 会话仿真快照与任务事件处理 |
| `route_planning/` | 分区与航线计算，独立于聊天回复 |

表中只写文件名的条目与上一条完整路径位于同一目录。任务页聊天的自然语言回复由模型生成；规划、定位和状态校验由确定性代码执行，并将结果作为结构化数据传给模型。

## 在本地运行

队友获得仓库访问权限后，先运行 `git clone <团队仓库地址>`，再进入克隆后的项目根目录。建议使用 Python 3.13 和 Node.js 24；当前开发机使用这两个版本。后端需要本机可用的 Redis 兼容服务，默认地址为 `localhost:6379`。Windows 可使用 Memurai，也可自行运行 Redis。以下命令在 PowerShell 中从仓库根目录执行。

1. 创建 Python 虚拟环境并安装依赖：

   ```powershell
   py -3.13 -m venv SwarmBuddy/.venv
   & .\SwarmBuddy\.venv\Scripts\python.exe -m pip install --upgrade pip
   & .\SwarmBuddy\.venv\Scripts\python.exe -m pip install "agentscope[full]" pypdfium2 pillow python-docx
   & .\SwarmBuddy\.venv\Scripts\python.exe -m pip install -r SwarmBuddy/agent_service/requirements-route-planning.txt
   ```

   后端启动时会优先从仓库的 `src/agentscope/` 加载本项目使用的 AgentScope 源码。安装 `agentscope[full]` 用于提供其第三方依赖。

2. 启动 Redis 兼容服务，并在一个 PowerShell 窗口启动后端：

   ```powershell
   cd SwarmBuddy/agent_service
   & ..\.venv\Scripts\python.exe main.py
   ```

   后端默认监听 `http://localhost:8000`。

3. 在另一个 PowerShell 窗口安装并启动前端：

   ```powershell
   cd SwarmBuddy/web_ui/frontend
   npm install
   npm run dev
   ```

   浏览器打开 `http://localhost:5173`。如果页面未连接后端，在“系统设置”中把服务地址设为 `http://localhost:8000`。

前端工程还包含 `SwarmBuddy/web_ui/backend/` Node 服务。需要使用其 `/api` 开发接口时，在该目录分别运行 `npm install` 和 `npm run dev`，默认端口为 3000。

## 模型与数据

- 模型 API 凭证在各自的本地页面配置；不要把密钥写进源码、README 或提交到 Git。
- 可选的地图工具通过环境变量 `AMAP_API_KEY` 配置。其他外部服务按实际使用情况另行配置。
- 本地会话、上传文件、扫描结果、向量库和虚拟环境均不纳入版本控制。队友克隆后需自行导入有权使用的 GeoJSON 数据。
- 项目内的卫星影像来自外部服务，地图能否显示取决于网络连接及服务可用性。

## 团队协作

每项任务从最新的 `main` 创建独立分支。完成后推送分支并发起 Pull Request，由另一位成员检查后合并。修改依赖时同步更新依赖清单或锁文件；本地运行数据和 API 密钥不要提交。提交前运行 `git status`，确认暂存文件符合预期。

完整项目尚未从此根目录上传 GitHub。首次上传时，先确认要使用的团队仓库地址和可见性，再从仓库根目录初始化和推送。
