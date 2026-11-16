# Agent Service

## 疑似目标协作评议

`TARGET_SUSPECTED` 事件先收集各资产提案，再由独立评议调用检查提案。
评议必须引用 `review_context` 或 `proposals` 中实际存在的字段。
被质疑的资产有一次修订机会；最终提案仍须通过现有角色、分区和状态校验。
事件记录保存 `original_proposals`、最终 `proposals`、`peer_review`、
`revisions`、执行的 `actions` 和确定性 `assessment`。未配置模型、模型失败或
超时会保留原提案并标为 `unavailable`。
后续事件向每个资产提供最多三条与其有关的评议反馈，供模型重新考虑建议。
这属于上下文反馈，不会更新模型参数。资产建议并发调用，单次限时十秒；
评议限时十二秒，修订沿用建议调用的超时限制。评议与修订仍在当前事件的
任务锁内执行，因此配置模型后疑似目标事件的响应时间会增加。

`assessment` 只统计当前记录可核验的提案、回退、校验和动作数量。
收到关联的 `VERIFY_COMPLETED` 后，还会记录复核完成状态与经过时间。
目标真伪、扫描覆盖损失和任务成效目前没有可靠结果数据，因此
`outcome_score` 保持 `null`，不得把这些计数解释为任务效果评分。
CoMAS 的零和奖励没有用于任务动作。

Agent service is a FastAPI-based, multi-tenant and multi-session service built with AgentScope 2.0.

This example demonstrates

- how to set up the agent service with Redis storage, and
- how to launch the service and its companion Web UI

Details about the agent service please refer to the [tutorial](https://docs.agentscope.io/latest/en/deploy/agent-service).

## Prerequisites

- Python ≥ 3.11
- Node.js ≥ 20 with `npx`
- [optional] Gaode/AMap API key in `AMAP_API_KEY` (for the `amap` MCP)

## Quickstart

### 预海天气接入

在 `SwarmBuddy/agent_service/.env` 中填写一次令钥：

```text
FOREOCEAN_TOKEN=你的应用Token
```

此文件已被 Git 忽略。保存后重启后端即可：

```powershell
.\Start-SwarmBuddy.ps1 -RestartBackend
```

从仓库根目录运行上述启动命令。配置后，任务看板按已保存航迹中点查询预海天气：气温、风速和能见度均来自 `weather/realtime` 接口。看板每五分钟刷新。未设置 Token 时沿用 NOAA NDBC 附近浮标数据源，此时没有气温字段，显示为 `—`。示例航迹查询的是示例坐标处的天气，悬停看板可查看采样坐标。

Install AgentScope from PyPI or source:

```bash
uv pip install agentscope[full]
# or
# uv pip install -e [full]
uv pip install pypdfium2 pillow python-docx  # knowledge document cover previews
```

Install Redis and start it as backend storage:

```bash
# macOS (Homebrew)
brew install redis
brew services start redis

# Linux (systemd)
sudo apt install redis-server
sudo systemctl start redis-server

# Docker (cross-platform)
docker run --rm -p 6379:6379 redis:7
```

Start the agent service:

```bash
cd examples/agent_service

python main.py
```

Launch the Web UI in a separate terminal to experience a chat-style interface:

```bash
cd examples/web_ui/

pnpm install
# or npm install

# Run in dev mode
pnpm dev
```

After that, you can set the API endpoint `http://localhost:8000` in the Web UI and start experiencing the agent service.

<img src="https://gw.alicdn.com/imgextra/i2/O1CN01Phmg1G1brIVC8WXyU_!!6000000003518-2-tps-2938-1736.png" alt="Web UI Screenshot" width="100%">

## What Next

- You can customize the service in `main.py` by adding your own MCPs, middlewares, or workspace manager implementations.

- Experience the agent service, including
    - human-in-the-loop interactions & permission system
<img src="https://gw.alicdn.com/imgextra/i1/O1CN01vGGiBw20agWwpzmjy_!!6000000006866-2-tps-2934-1732.png" alt="Permission System" width="100%">

    - schedule tasks
<img src="https://gw.alicdn.com/imgextra/i1/O1CN01Xi3Qw71E2haKKu4z0_!!6000000000294-2-tps-2932-1738.png" alt="Schedule Tasks" width="100%">

    - and more! (stay tuned for future updates)
