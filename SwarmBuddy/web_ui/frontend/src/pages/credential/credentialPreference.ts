import type { ChatModelConfig } from '@/api';
import { getUserId } from '@/api/client';

const key = () => `swarmbuddy.chatCredentialPreference:${getUserId()}`;

export function readChatCredentialPreference(): ChatModelConfig | null {
	try {
		const value = JSON.parse(localStorage.getItem(key()) ?? 'null') as ChatModelConfig | null;
		return value && typeof value.type === 'string' && typeof value.credential_id === 'string' && typeof value.model === 'string' && value.parameters && typeof value.parameters === 'object' ? value : null;
	} catch {
		return null;
	}
}

export function saveChatCredentialPreference(config: ChatModelConfig): void {
	localStorage.setItem(key(), JSON.stringify(config));
}
