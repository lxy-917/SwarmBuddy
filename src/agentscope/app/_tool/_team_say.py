# -*- coding: utf-8 -*-
"""The TeamSay tool — sends a message to one or all team members."""
import json
from typing import Any

from pydantic import Field

from ._constants import HANDLE_LEN
from ._team_tool_base import _TeamToolBase
from .._bus_ops import deliver_to_inbox
from ..storage._utils import _ensure_team_members, _resolve_team_leader
from ...message import HintBlock, TextBlock, ToolResultState
from ...tool import ToolChunk, ParamsBase


class _TeamSayParams(ParamsBase):
    """Parameters for :class:`TeamSay`."""

    content: str = Field(
        description=(
            "The message text. Plain natural-language; the recipient "
            "sees it as a user message in its context."
        ),
    )
    to: str | None = Field(
        default=None,
        description=(
            "Recipient member name. Pass ``null`` (the default) to "
            "broadcast to every other member of the team. To address "
            "a specific peer use that member's name."
        ),
    )


_LEADER_DESCRIPTION = """向指定团队成员发消息，或向全体成员广播。

## 适用场景
- 传达用户新增的要求或背景，协调成员工作，或提出必要的追问。
- 成员创建后会立即执行 AgentCreate 中的 prompt，完成后会主动使用 TeamSay 汇报。

## 使用要求
- 不要反复发消息查询进度；等待成员主动汇报。
- 不要在 AgentCreate 后立即重复发送初始任务。
- 未创建团队时先调用 TeamCreate。
- 没有新增要求或问题时，不必回复成员的汇报；集中完成整体任务。
"""

_WORKER_DESCRIPTION = """向团队负责人发消息，或向全体成员广播。

完成分配的任务时，必须通过此工具向负责人汇报结果，不能直接结束。
有关键阶段发现、需要澄清的问题或其他成员需要的信息时，也可使用此工具。
不要发送没有实际协作价值的内部想法。
"""


class TeamSay(_TeamToolBase):
    """Send a message to a teammate (or broadcast to all teammates).

    Resolves the team membership at ``__call__`` time from storage,
    so a member added moments earlier in the same chat run is
    addressable immediately.

    The ``description`` shown to the agent differs by role: leaders
    are reminded not to poll members, workers are reminded to report
    results when done. The role is passed at construction time via
    the ``role`` parameter.
    """

    name: str = "TeamSay"
    description: str

    is_concurrency_safe: bool = True
    is_read_only: bool = True

    input_schema: dict = _TeamSayParams.model_json_schema()

    def __init__(
        self,
        *args: Any,
        role: str = "leader",
        **kwargs: Any,
    ) -> None:
        """Initialise with role-specific description.

        Args:
            role (`str`, defaults to ``"leader"``):
                Either ``"leader"`` or ``"worker"``. Determines which
                description the agent sees for this tool.
            *args:
                Forwarded to :class:`_TeamToolBase.__init__`.
            **kwargs:
                Forwarded to :class:`_TeamToolBase.__init__`.
        """
        super().__init__(*args, **kwargs)
        self.description = (
            _LEADER_DESCRIPTION if role == "leader" else _WORKER_DESCRIPTION
        )

    async def __call__(
        self,
        content: str,
        to: str | None = None,
    ) -> ToolChunk:
        """Deliver the message directly via storage + message bus.

        Reads the current session record from storage to resolve the
        team_id (the agent's team membership may have changed since
        agent assembly), builds the team's (agent_id, session_id)
        directory, and pushes a HintBlock + wakeup to each recipient.

        Args:
            content (`str`):
                Message body.
            to (`str | None`, defaults to ``None``):
                Display name of a specific team member to target, or
                ``None`` for broadcast.  Routing is by name (not
                agent id) so workers can address the leader by the
                name they see in ``<team-message from="...">``.
                Name uniqueness within a team is enforced at
                ``AgentCreate`` time.

        Returns:
            `ToolChunk`:
                A confirmation containing the recipient count, or an
                error chunk on failure.
        """
        try:
            team = await self._require_team()

            # Build a (name -> (session_id, agent_id)) directory. The
            # leader is always in the directory under its plain agent
            # name; workers come from the team's members roster via
            # ``ensure_team_members`` (which migrates legacy
            # ``member_ids``-only records on first read). Invited
            # members display as ``"<name>@<agent_id[:8]>"`` so a
            # borrowed agent whose name collides with an already-created
            # member (or the leader) remains addressable.
            #
            # Uniqueness of the resulting display strings within a team
            # is preserved by the AgentCreate name check (which rejects
            # ``@``) and by AgentInvite's one-borrow-per-agent-per-team
            # rule.
            leader = await _resolve_team_leader(
                self._storage,
                self._user_id,
                team,
            )
            if leader is None:
                return ToolChunk(
                    content=[
                        TextBlock(
                            text=(
                                f"TeamSay: leader records missing for "
                                f"team {team.id}."
                            ),
                        ),
                    ],
                    state=ToolResultState.ERROR,
                )
            directory: dict[str, tuple[str, str]] = {
                leader.name: (leader.session_id, leader.agent.id),
            }
            members = await _ensure_team_members(
                self._storage,
                self._user_id,
                team,
            )
            for member in members:
                member_agent = await self._storage.get_agent(
                    member.owner_id,
                    member.agent_id,
                )
                if member_agent is None:
                    continue
                if member.role == "invited":
                    display = (
                        f"{member_agent.data.name}"
                        f"@{member.agent_id[:HANDLE_LEN]}"
                    )
                else:
                    display = member_agent.data.name
                directory[display] = (member.session_id, member.agent_id)

            own_session_ids = {sid for sid, _aid in directory.values()}
            if self._session_id not in own_session_ids:
                return ToolChunk(
                    content=[
                        TextBlock(
                            text=(
                                f"TeamSay: this session "
                                f"({self._session_id}) is not part of "
                                f"team {team.id}."
                            ),
                        ),
                    ],
                    state=ToolResultState.ERROR,
                )

            if to is None:
                recipients: list[tuple[str, str]] = [
                    (sid, aid)
                    for sid, aid in directory.values()
                    if sid != self._session_id
                ]
            else:
                resolved = directory.get(to)
                if resolved is None:
                    known = sorted(directory.keys())
                    return ToolChunk(
                        content=[
                            TextBlock(
                                text=(
                                    f"TeamSay: no team member is named "
                                    f"{to!r}. Known members: {known}."
                                ),
                            ),
                        ],
                        state=ToolResultState.ERROR,
                    )
                target_session_id, target_agent_id = resolved
                if target_session_id == self._session_id:
                    return ToolChunk(
                        content=[
                            TextBlock(
                                text=(
                                    "TeamSay: cannot send a message to "
                                    "yourself; talk to yourself in your "
                                    "own reasoning instead."
                                ),
                            ),
                        ],
                        state=ToolResultState.ERROR,
                    )
                recipients = [(target_session_id, target_agent_id)]

            # Resolve sender display name once.
            sender_agent = await self._storage.get_agent(
                self._user_id,
                self._agent_id,
            )
            sender_name = (
                sender_agent.data.name
                if sender_agent is not None
                else self._agent_id
            )

            hint = HintBlock(
                hint=(
                    f'<team-message from="{sender_name}">\n'
                    f"{content}\n"
                    f"</team-message>"
                ),
                source=json.dumps(
                    {"label": "team", "sublabel": sender_name},
                    ensure_ascii=False,
                ),
            )
            payload = hint.model_dump(mode="json")

            for sid, aid in recipients:
                await deliver_to_inbox(
                    self._message_bus,
                    user_id=self._user_id,
                    session_id=sid,
                    agent_id=aid,
                    payload=payload,
                )

            count = len(recipients)
            target = "broadcast" if to is None else f"member {to!r}"
            return ToolChunk(
                content=[
                    TextBlock(
                        text=(
                            f"Delivered to {count} recipient(s) "
                            f"({target})."
                        ),
                    ),
                ],
            )
        except Exception as e:  # pylint: disable=broad-except
            return ToolChunk(
                content=[TextBlock(text=f"TeamSay failed: {e}")],
                state=ToolResultState.ERROR,
            )
