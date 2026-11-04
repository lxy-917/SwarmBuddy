import { client } from './client';
import type { AddFromLibraryResponse, Skill } from './types';

export const projectSkillApi = {
	list: (agentId: string) => client.get<Skill[]>(`/project/skills/${encodeURIComponent(agentId)}`, undefined, { silent: true }),
	add: (agentId: string, skillIds: string[]) => client.post<AddFromLibraryResponse>(`/project/skills/${encodeURIComponent(agentId)}`, { skill_ids: skillIds }),
	remove: (agentId: string, skillName: string) => client.delete(`/project/skills/${encodeURIComponent(agentId)}/${encodeURIComponent(skillName)}`),
};
