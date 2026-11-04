import type { KnowledgeBaseView } from '@/api';
import { client, getUserId } from '@/api/client';

export interface PublicKnowledgeCollection {
    id: string;
    name: string;
    description: string;
    icon: string;
    source: string;
}

export interface PublicKnowledgeRecord {
    id: string;
    title: string;
    content: string;
    authors: string[];
    year: number | null;
    url: string;
    source: string;
    license: string;
}

export function publicRecordFileName(record: PublicKnowledgeRecord) {
    const title = record.title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 76);
    const id = record.id.replace(/[\\/:*?"<>|]/g, '-').slice(0, 100);
    return `${id} - ${title || '公开文档'}.txt`;
}

export function publicRecordText(record: PublicKnowledgeRecord) {
    return `标题：${record.title}\n来源：${record.source}\n许可：${record.license}\n原文链接：${record.url}\n\n内容：\n${record.content}`;
}

export const publicKnowledgeApi = {
    catalog: () => client.get<{ collections: PublicKnowledgeCollection[] }>('/knowledge/discover'),
    search: (query: string) => client.get<{ collections: PublicKnowledgeCollection[] }>('/knowledge/discover/search', { query }),
    records: (id: string) => client.get<{ records: PublicKnowledgeRecord[] }>(`/knowledge/discover/${encodeURIComponent(id)}/records`),
};

export interface PublicKnowledgeSubscription {
    collectionId: string;
    knowledgeBaseId: string;
}

function storageKey() { return `swarmbuddy.publicKnowledge.${getUserId()}`; }

export function readPublicSubscriptions(): PublicKnowledgeSubscription[] {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(storageKey()) ?? '[]');
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is PublicKnowledgeSubscription =>
            typeof item?.collectionId === 'string' && typeof item?.knowledgeBaseId === 'string');
    } catch { return []; }
}

export function publicSubscriptionsForBases(bases: KnowledgeBaseView[]): PublicKnowledgeSubscription[] {
    const visible = new Set(bases.map((base) => base.id));
    const stored = readPublicSubscriptions().filter((item) => visible.has(item.knowledgeBaseId));
    for (const base of bases) {
        const collectionId = base.description.match(/来源：GitHub。订阅编号：(github:[a-z0-9_.-]+\/[a-z0-9_.-]+)/i)?.[1];
        if (collectionId && !stored.some((item) => item.knowledgeBaseId === base.id)) {
            stored.push({ collectionId, knowledgeBaseId: base.id });
        }
    }
    return stored;
}

export function savePublicSubscription(subscription: PublicKnowledgeSubscription) {
    const next = readPublicSubscriptions().filter((item) => item.collectionId !== subscription.collectionId);
    localStorage.setItem(storageKey(), JSON.stringify([...next, subscription]));
}

export function removePublicSubscription(knowledgeBaseId: string) {
    localStorage.setItem(storageKey(), JSON.stringify(readPublicSubscriptions().filter((item) => item.knowledgeBaseId !== knowledgeBaseId)));
}
