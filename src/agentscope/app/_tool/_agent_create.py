# -*- coding: utf-8 -*-
"""The AgentCreate tool — spawns a worker into the current team."""
from __future__ import annotations

import copy
import json
from typing import TYPE_CHECKING

from pydantic import Field

from ._team_tool_base import _TeamToolBase
from .._types import SubAgentTemplate
from .._bus_ops import deliver_to_inbox
from ..storage import (
    AgentData,
    AgentRecord,
    AgentChatConfig,
    SessionConfig,
    TeamMember,
    TeamOrigin,
)
from ..storage._utils import _ensure_team_members, _resolve_team_leader
from ...message import HintBlock, TextBlock, ToolResultState
from ...permission import PermissionContext
from ...state import AgentState
from ...tool import ToolChunk, ParamsBase

if TYPE_CHECKING:
    from ..message_bus import MessageBus
    from ..storage import StorageBase
    from ..workspace_manager import WorkspaceManagerBase


_DEFAULT_SYSTEM_PROMPT_TEMPLATE = (
    "你是 {member_name}，属于由 {leader_name} 负责的团队“{team_name}”。\n\n"
    "团队任务：{team_description}\n\n"
    "你的职责：{member_description}\n\n"
    "通过 TeamSay 工具向负责人和团队成员传递实际发现、结果与阻碍；"
    "保留内部推理，不把未经核验的判断写成事实。"
)

DEFAULT_SUB_AGENT_TEMPLATE = SubAgentTemplate(
    type="default",
    description="使用标准配置的团队工作智能体。",
    system_prompt_template=_DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    override_leader_mode=False,
    extend_leader_permission_rules=True,
    extend_leader_working_directories=True,
)
# 内置默认子智能体模板。未注册自定义模板或未指定 subagent_type 时使用。
# 开发者可通过 create_app 注册 type="default" 的模板覆盖它。
# 默认成员继承负责人的权限模式、工作目录和规则。


def _merge_leader_permissions(
    template: SubAgentTemplate,
    leader_context: PermissionContext,
) -> PermissionContext:
    """Build the worker's permission context from the template, layered
    with the leader's runtime state according to the template's three
    inherit-from-leader flags.

    - ``override_leader_mode``: if True, the template's
      :attr:`PermissionContext.mode` wins; otherwise the worker
      inherits the leader's mode.
    - ``extend_leader_permission_rules``: if True, the leader's
      allow/deny/ask rules are appended after the template's rules for
      each tool, so the worker doesn't re-prompt for permissions the
      user has already granted in the leader session. The template's
      rules appear first in each list, so the engine — which returns
      on the first matching rule per stage — evaluates the template's
      intent before the leader's.
    - ``extend_leader_working_directories``: if True, the leader's
      working directories are merged in; on key (path) collisions the
      template's entry wins.

    The template fields are deep-copied so the returned context is
    independent of both the template and the leader state.
    """
    merged = template.permission_context.model_copy(deep=True)

    if not template.override_leader_mode:
        merged.mode = leader_context.mode

    if template.extend_leader_working_directories:
        for path, wd in leader_context.working_directories.items():
            merged.working_directories.setdefault(
                path,
                wd.model_copy(deep=True),
            )

    if template.extend_leader_permission_rules:
        for attr in ("allow_rules", "deny_rules", "ask_rules"):
            merged_rules: dict = getattr(merged, attr)
            for tool_name, rules in getattr(leader_context, attr).items():
                merged_rules.setdefault(tool_name, []).extend(
                    r.model_copy(deep=True) for r in rules
                )

    return merged


class _AgentCreateParams(ParamsBase):
    """Parameters for :class:`AgentCreate`."""

    name: str = Field(
        description=(
            'Short identifier for the new member, e.g. ``"researcher"`` '
            'or ``"coder-1"``. Other members address it via '
            "``TeamSay(to=<this name>)``, so it MUST be unique within "
            "the team."
        ),
    )
    description: str = Field(
        description=(
            "One-sentence summary of the member's role — e.g. "
            '``"Researches background information on the target topic"``. '
            "Becomes part of the member's system prompt so it understands "
            "its place in the team."
        ),
    )
    prompt: str = Field(
        description=(
            "The first task delivered to the member as a user message. "
            "The member begins executing immediately upon creation, so "
            "make this concrete and self-contained — do not just say "
            '``"wait for instructions"`` (use TeamSay later instead). '
            "Include any context, constraints, deliverables, and "
            "deadlines the member needs."
        ),
    )


class AgentCreate(_TeamToolBase):
    """在当前负责的团队中新建工作智能体。"""

    name: str = "AgentCreate"
    is_state_injected: bool = True

    description: str = """在你负责的团队中新建成员。

先调用 TeamCreate。每次调用会创建一名成员，并将 `prompt` 作为其第一条任务消息；
成员会立即开始工作，完成后通过 TeamSay 向你汇报，无需重复发送初始任务。
已有成员能够承担任务时，可通过 TeamSay 继续安排，不必创建职责重复的成员。

`name` 在团队内必须唯一；之后可在 TeamSay 中用 `to=<name>` 指定该成员。
团队通过 TeamDelete 删除后，成员也会一并删除。
你负责分配任务、收集各成员结果并给用户最终答复；让成员直接向你汇报。
"""

    input_schema: dict = _AgentCreateParams.model_json_schema()

    def __init__(
        self,
        storage: "StorageBase",
        message_bus: "MessageBus",
        workspace_manager: "WorkspaceManagerBase",
        user_id: str,
        session_id: str,
        agent_id: str,
        sub_agent_templates: dict[str, SubAgentTemplate] | None = None,
    ) -> None:
        """Bind the base dependencies plus the sub-agent templates.

        The built-in ``"default"`` template is always injected; extra
        templates unlock a ``subagent_type`` enum in the input schema.

        Args:
            storage (`StorageBase`):
                Application storage backend.
            message_bus (`MessageBus`):
                Application message bus.
            workspace_manager (`WorkspaceManagerBase`):
                Forwarded to the base for uniform team-tool wiring;
                unused here — a worker inherits the leader's workspace.
            user_id (`str`):
                The owner user id.
            session_id (`str`):
                The calling session id.
            agent_id (`str`):
                The calling agent id.
            sub_agent_templates (`dict[str, SubAgentTemplate] | None`, \
optional):
                Template registry keyed by type.
        """
        super().__init__(
            storage,
            message_bus,
            workspace_manager,
            user_id,
            session_id,
            agent_id,
        )

        self._sub_agent_templates: dict[str, SubAgentTemplate] = dict(
            sub_agent_templates or {},
        )
        if "default" not in self._sub_agent_templates:
            self._sub_agent_templates["default"] = DEFAULT_SUB_AGENT_TEMPLATE

        # Only expose subagent_type when the developer registered
        # custom templates — a single "default" type is redundant in
        # the schema and would confuse the LLM.
        has_custom_templates = set(self._sub_agent_templates) != {"default"}
        if has_custom_templates:
            schema = copy.deepcopy(
                _AgentCreateParams.model_json_schema(),
            )
            type_descriptions = "\n".join(
                f"- ``{t.type!r}`` — {t.description}"
                for t in self._sub_agent_templates.values()
            )
            schema["properties"]["subagent_type"] = {
                "type": "string",
                "enum": list(self._sub_agent_templates),
                "description": (
                    "The type of sub-agent template to use. "
                    "Available types:\n\n"
                    f"{type_descriptions}\n\n"
                    "Each type has pre-configured system prompt, "
                    "permissions, and task context."
                ),
            }
            self.input_schema = schema

    async def __call__(
        self,
        name: str,
        description: str,
        prompt: str,
        subagent_type: str = "default",
        _agent_state: AgentState | None = None,
    ) -> ToolChunk:
        """Spawn the worker agent + session directly via storage.

        Reads the current session + team records from storage to
        enforce two preconditions: the calling session must be in a
        team, and it must be that team's leader.

        The worker's configuration (system prompt, context/react
        config, permission context, task context) is determined by
        the :class:`SubAgentTemplate` matching ``subagent_type``. The
        leader's user-confirmed permission rules and working
        directories are merged into the template's permission context
        so the worker does not re-prompt for permissions the user has
        already granted.

        Args:
            name (`str`):
                Short identifier for the worker, unique within the
                team. Used as the ``to`` target in ``TeamSay``.
            description (`str`):
                One-sentence summary of the worker's role.
            prompt (`str`):
                First task delivered as a user message to the worker.
            subagent_type (`str`, defaults to ``"default"``):
                Template type to use. Must match a registered
                :class:`SubAgentTemplate.type`.
            _agent_state (`AgentState | None`, optional):
                Live leader state injected by the toolkit.

        Returns:
            `ToolChunk`:
                A success message containing the new member id, or an
                error chunk on failure.
        """
        try:
            team = await self._require_leader_team("add members")

            # Look up leader session for chat-model inheritance + name.
            leader_session = await self._storage.get_session(
                self._user_id,
                "",  # agent_id unused at storage level
                team.session_id,
            )
            if leader_session is None:
                return ToolChunk(
                    content=[
                        TextBlock(
                            text=(
                                f"AgentCreate: leader session "
                                f"{team.session_id} for team {team.id} is "
                                f"missing — team is in an inconsistent "
                                f"state."
                            ),
                        ),
                    ],
                    state=ToolResultState.ERROR,
                )

            # Resolve the template.
            template = self._sub_agent_templates.get(subagent_type)
            if template is None:
                available = list(self._sub_agent_templates)
                return ToolChunk(
                    content=[
                        TextBlock(
                            text=(
                                f"AgentCreate: unknown subagent_type "
                                f"{subagent_type!r}; expected one of "
                                f"{available}."
                            ),
                        ),
                    ],
                    state=ToolResultState.ERROR,
                )

            # Enforce team-scoped name uniqueness. TeamSay routes by
            # ``name`` (not agent_id), so duplicates would be ambiguous
            # and unaddressable. The leader's name participates too —
            # workers must not collide with it.
            #
            # Also reject ``@`` in the name: invited members display as
            # ``"<name>@<agent_id[:8]>"`` in TeamSay, and letting a
            # created member sneak an ``@`` into its name would make
            # the two routing forms visually collide.
            if "@" in name:
                return ToolChunk(
                    content=[
                        TextBlock(
                            text=(
                                f"AgentCreate: member name {name!r} cannot "
                                f"contain the character '@'."
                            ),
                        ),
                    ],
                    state=ToolResultState.ERROR,
                )

            leader = await _resolve_team_leader(
                self._storage,
                self._user_id,
                team,
            )
            # Fall back to the id so a missing leader agent record does
            # not block member creation.
            leader_name = leader.name if leader else leader_session.agent_id
            existing_names: set[str] = {leader_name}
            members = await _ensure_team_members(
                self._storage,
                self._user_id,
                team,
            )
            for member in members:
                member_record = await self._storage.get_agent(
                    member.owner_id,
                    member.agent_id,
                )
                if member_record is not None:
                    existing_names.add(member_record.data.name)
            if name in existing_names:
                return ToolChunk(
                    content=[
                        TextBlock(
                            text=(
                                f"AgentCreate: a team member named "
                                f"{name!r} already exists. Member names "
                                f"must be unique within the team "
                                f"(including the leader's name); pick "
                                f"another."
                            ),
                        ),
                    ],
                    state=ToolResultState.ERROR,
                )

            # 1. Build worker AgentRecord (source="team" so it's hidden
            #    from the global agent list).
            system_prompt = template.system_prompt_template.format(
                team_name=team.data.name,
                team_description=team.data.description,
                member_name=name,
                member_description=description,
                leader_name=leader_name,
            )
            worker_agent = AgentRecord(
                user_id=self._user_id,
                source="team",
                data=AgentData(
                    name=name,
                    system_prompt=system_prompt,
                    chat_config=AgentChatConfig(
                        context_config=template.context_config,
                        react_config=template.react_config,
                    ).model_copy(deep=True),
                ),
            )
            await self._storage.upsert_agent(self._user_id, worker_agent)

            # 2. Build worker SessionRecord, inheriting leader's model
            #    config. The template's permission context is the base;
            #    on top of it we merge the leader's mode and/or rules
            #    and/or working directories according to the template's
            #    inherit-from-leader flags. See
            #    :func:`_merge_leader_permissions` for the policy.
            leader_permission_context = (
                _agent_state.permission_context
                if _agent_state is not None
                else leader_session.state.permission_context
            )
            worker_permission_context = _merge_leader_permissions(
                template,
                leader_permission_context,
            )
            worker_state = AgentState(
                permission_context=worker_permission_context,
                tasks_context=template.tasks_context.model_copy(
                    deep=True,
                ),
            )
            worker_session = await self._storage.upsert_session(
                user_id=self._user_id,
                agent_id=worker_agent.id,
                config=SessionConfig(
                    workspace_id=leader_session.config.workspace_id,
                    name=f"team:{team.id}/{name}",
                    chat_model_config=(
                        leader_session.config.chat_model_config
                    ),
                    fallback_chat_model_config=(
                        leader_session.config.fallback_chat_model_config
                    ),
                ),
                state=worker_state,
                origin=TeamOrigin(),
            )
            await self._storage.set_session_team_id(
                self._user_id,
                worker_session.id,
                team.id,
            )

            # 3. Append worker to the team roster. Write both the
            #    legacy ``member_ids`` (for backwards-compatible
            #    readers) and the new ``members`` entry with
            #    ``role="created"`` — the two must stay in sync so
            #    ``ensure_team_members`` and any legacy reader agree
            #    on membership. ``members`` above was materialised via
            #    the same helper, so it includes any prior migration.
            team.data.member_ids = [
                *team.data.member_ids,
                worker_agent.id,
            ]
            team.data.members = [
                *members,
                TeamMember(
                    owner_id=self._user_id,
                    agent_id=worker_agent.id,
                    session_id=worker_session.id,
                    role="created",
                ),
            ]
            await self._storage.upsert_team(self._user_id, team)

            # 4. Deliver the initial task to the worker's inbox + wakeup.
            hint = HintBlock(
                hint=(
                    f'<team-message from="{leader_name}">\n'
                    f"{prompt}\n"
                    f"</team-message>"
                ),
                source=json.dumps(
                    {
                        "label": "team_message",
                        "sublabel": leader_name,
                    },
                    ensure_ascii=False,
                ),
            )
            await deliver_to_inbox(
                self._message_bus,
                user_id=self._user_id,
                session_id=worker_session.id,
                agent_id=worker_agent.id,
                payload=hint.model_dump(mode="json"),
            )

            return ToolChunk(
                content=[
                    TextBlock(
                        text=(
                            f"Member {name!r} added to team "
                            f"{team.data.name!r}."
                        ),
                    ),
                ],
            )
        except Exception as e:  # pylint: disable=broad-except
            return ToolChunk(
                content=[TextBlock(text=f"AgentCreate failed: {e}")],
                state=ToolResultState.ERROR,
            )
