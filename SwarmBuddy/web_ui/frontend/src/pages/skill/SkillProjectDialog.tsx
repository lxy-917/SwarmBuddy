import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { skillApi, type Skill, type SkillRecord, type SkillView } from '@/api';
import { ApiError } from '@/api/client';
import { projectSkillApi } from '@/api/projectSkill';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAgents } from '@/hooks/useAgents';
import { COLLABORATION_AGENT_NAME } from '@/pages/collaboration/collaborationDraft';
import { isKnowledgeChatAgent } from '@/pages/knowledge/knowledgeChat';

function findInstalledSkill(items: Skill[], skill: SkillView, record: SkillRecord): Skill | undefined {
	// 技能库名称可能是别名；工作区使用 SKILL.md 中的实际名称。
	return items.find((item) => item.name === skill.name || Boolean(record.markdown) && item.markdown === record.markdown);
}

function projectSkillError(cause: unknown): string {
	if (cause instanceof ApiError && cause.status === 404 && cause.detail === 'Not Found') {
		return '当前后端尚未加载项目技能接口，请重启 SwarmBuddy 后端。';
	}
	return cause instanceof Error ? cause.message : '项目技能操作失败，请重试。';
}

export function SkillProjectDialog({ skill, onClose }: { skill: SkillView | null; onClose: () => void }) {
	const navigate = useNavigate();
	const { agents, loading: agentsLoading } = useAgents();
	const [agentId, setAgentId] = useState('');
	const [attached, setAttached] = useState<boolean | null>(null);
	const [attachedName, setAttachedName] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');

	useEffect(() => {
		setAgentId('');
		setAttached(null);
		setAttachedName(null);
		setError('');
		setNotice('');
	}, [skill?.id]);

	useEffect(() => {
		if (!skill || !agentId) return;
		let active = true;
		setLoading(true);
		setAttached(null);
		setError('');
		void Promise.all([projectSkillApi.list(agentId), skillApi.get(skill.id)]).then(([items, record]) => {
			if (!active) return;
			const match = findInstalledSkill(items, skill, record);
			setAttached(Boolean(match));
			setAttachedName(match?.name ?? null);
		}).catch((cause: unknown) => {
			if (active) setError(projectSkillError(cause));
		}).finally(() => {
			if (active) setLoading(false);
		});
		return () => { active = false; };
	}, [skill, agentId]);

	const changeAttachment = async () => {
		if (!skill || !agentId || attached === null || busy) return;
		setBusy(true);
		setError('');
		setNotice('');
		try {
			if (attached) {
				if (!attachedName) throw new Error('未找到项目中的技能，请重新选择项目。');
				await projectSkillApi.remove(agentId, attachedName);
				setAttached(false);
				setAttachedName(null);
				setNotice('已从项目移除技能。');
			} else {
				const result = await projectSkillApi.add(agentId, [skill.id]);
				const failure = Object.values(result.failed)[0];
				if (failure) throw new Error(failure);
				const [current, record] = await Promise.all([projectSkillApi.list(agentId), skillApi.get(skill.id)]);
				const match = findInstalledSkill(current, skill, record);
				if (!match) throw new Error('服务端尚未显示该技能，请稍后重试。');
				setAttached(true);
				setAttachedName(match.name);
				setNotice('已添加到项目，同项目的普通会话可使用。');
			}
		} catch (cause) {
			setError(projectSkillError(cause));
		} finally {
			setBusy(false);
		}
	};

	const chatAgents = agents.filter((agent) => agent.editable && agent.data.name !== COLLABORATION_AGENT_NAME && !isKnowledgeChatAgent(agent.data.name));
	return <Dialog open={Boolean(skill)} onOpenChange={(open) => { if (!open) onClose(); }}>
		<DialogContent className="swarm-skill-project-dialog sm:max-w-md">
			<DialogHeader>
				<DialogTitle>添加技能到项目</DialogTitle>
				<DialogDescription>{skill?.display_name || skill?.name} 会添加到所选项目的共享工作区。</DialogDescription>
			</DialogHeader>
			<div className="swarm-skill-project-fields">
				<label>项目 / Agent
					<select value={agentId} disabled={agentsLoading || busy} onChange={(event) => { setAgentId(event.target.value); setAttached(null); setNotice(''); }}>
						<option value="">请选择项目</option>
						{chatAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.data.name}</option>)}
					</select>
				</label>
			</div>
			{agentId && <p className="swarm-skill-project-note">{loading ? '正在检查项目技能…' : attached === true ? '此技能已添加到当前项目。' : attached === false ? '此技能尚未添加到当前项目。' : ''}</p>}
			{notice && <p className="swarm-skill-project-success" role="status">{notice}</p>}
			{error && <p className="swarm-skill-project-error" role="alert">{error}</p>}
			<DialogFooter>
				{agentId && <Button type="button" variant="outline" onClick={() => { onClose(); navigate(`/mission/${agentId}`); }}>打开项目</Button>}
				<Button type="button" disabled={!agentId || loading || attached === null || busy} variant={attached ? 'outline' : 'default'} onClick={() => void changeAttachment()}>{busy ? '处理中…' : attached ? '从项目移除' : '添加到项目'}</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>;
}
