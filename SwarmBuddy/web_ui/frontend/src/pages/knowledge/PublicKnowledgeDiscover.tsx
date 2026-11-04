import { ArrowUpRight, BookOpen, Bot, ChevronRight, Compass, Loader2, Network, Radar, RefreshCw, Route, Search, Shield, Waves, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { publicKnowledgeApi, publicRecordFileName, publicRecordText, savePublicSubscription, type PublicKnowledgeCollection, type PublicKnowledgeRecord } from './externalKnowledge';
import { qwen3VlEmbeddingConfig } from './knowledgeEmbedding';
import { knowledgeBaseApi } from '@/api';
import { useKbEmbeddingModels } from '@/hooks/useKbEmbeddingModels';

const icons = { waves: Waves, network: Network, radar: Radar, route: Route, bot: Bot, shield: Shield };

interface Props {
    onSubscribed: (knowledgeBaseId: string) => Promise<void>;
    subscribedCollectionIds: string[];
}

export function PublicKnowledgeDiscover({ onSubscribed, subscribedCollectionIds }: Props) {
    const [collections, setCollections] = useState<PublicKnowledgeCollection[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [searchResults, setSearchResults] = useState<PublicKnowledgeCollection[]>([]);
    const [searching, setSearching] = useState(false);
    const [rotation, setRotation] = useState(0);
    const [selected, setSelected] = useState<PublicKnowledgeCollection | null>(null);
    const [records, setRecords] = useState<PublicKnowledgeRecord[]>([]);
    const [recordsLoading, setRecordsLoading] = useState(false);
    const [subscribing, setSubscribing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { providers, policy } = useKbEmbeddingModels();
    const embedding = useMemo(() => qwen3VlEmbeddingConfig(providers, policy), [providers, policy]);
    const isSubscribed = (id: string) => subscribedCollectionIds.includes(id);

    useEffect(() => {
        let active = true;
        void publicKnowledgeApi.catalog().then(({ collections: items }) => { if (active) setCollections(items); })
            .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '暂时无法加载公开知识库。'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        const search = query.trim();
        if (search.length < 2) { setSearchResults([]); setSearching(false); return; }
        setSearchResults([]);
        let active = true;
        const timer = window.setTimeout(() => {
            setSearching(true);
            void publicKnowledgeApi.search(search).then(({ collections: items }) => { if (active) setSearchResults(items); })
                .catch(() => { if (active) setSearchResults([]); })
                .finally(() => { if (active) setSearching(false); });
        }, 400);
        return () => { active = false; window.clearTimeout(timer); };
    }, [query]);

    const localMatches = collections.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()));
    const filtered = query ? [...localMatches, ...searchResults.filter((item) => !localMatches.some((local) => local.id === item.id))] : localMatches;
    const featured = query ? [] : [collections[rotation % Math.max(collections.length, 1)], collections[(rotation + 1) % Math.max(collections.length, 1)]].filter(Boolean);
    const recommended = query ? filtered : filtered.filter((item) => !featured.some((picked) => picked.id === item.id));

    const openCollection = async (collection: PublicKnowledgeCollection) => {
        setSelected(collection);
        setRecords([]);
        setError(null);
        setRecordsLoading(true);
        try {
            const result = await publicKnowledgeApi.records(collection.id);
            setRecords(result.records);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '读取公开资料失败。');
        } finally { setRecordsLoading(false); }
    };

    const subscribe = async () => {
        if (!selected || !embedding || !records.length || subscribing) return;
        setSubscribing(true);
        setError(null);
        let knowledgeBaseId: string | null = null;
        try {
            const response = await knowledgeBaseApi.create({
                name: selected.name,
                description: `${selected.description}。来源：GitHub。订阅编号：${selected.id}。导入开放许可的部分公开文档。`,
                embedding_model_config: embedding,
            });
            knowledgeBaseId = response.knowledge_base_id;
            let imported = 0;
            for (const record of records) {
                const text = publicRecordText(record);
                const file = new File([text], publicRecordFileName(record), { type: 'text/plain' });
                try {
                    await knowledgeBaseApi.uploadDocument(knowledgeBaseId, file);
                    imported += 1;
                } catch { /* Keep the successfully imported records. */ }
            }
            if (imported === 0) throw new Error('文档导入失败，请检查知识库嵌入模型配置。');
            savePublicSubscription({ collectionId: selected.id, knowledgeBaseId });
            await onSubscribed(knowledgeBaseId);
        } catch (cause) {
            setError(`${cause instanceof Error ? cause.message : '订阅失败。'}${knowledgeBaseId ? ' 已创建订阅知识库，可在左侧打开后点击“同步更新”。' : ''}`);
        } finally { setSubscribing(false); }
    };

    const renderCard = (collection: PublicKnowledgeCollection) => {
        const Icon = icons[collection.icon as keyof typeof icons] ?? BookOpen;
        const subscribed = isSubscribed(collection.id);
        return <button className="swarm-kb-discover-card" key={collection.id} type="button" onClick={() => void openCollection(collection)}>
            <span className="swarm-kb-discover-icon"><Icon size={27} strokeWidth={1.6} /></span>
            <span className="swarm-kb-discover-card-copy"><strong>{collection.name}</strong><small>{collection.description}</small><em>{collection.source} · 开放许可文档{subscribed ? ' · 已订阅' : ''}</em></span>
            <ChevronRight size={17} className="swarm-kb-discover-chevron" />
        </button>;
    };

    return <main className="swarm-kb-discover" aria-label="发现公开知识库">
        <div className="swarm-kb-discover-head"><div><span className="swarm-kb-discover-kicker"><Compass size={18} /> 发现内容</span><h2>知识库</h2><p>发现开放许可的文档知识库，导入后可在 SwarmBuddy 中检索和提问。当前接入 GitHub 文档库。</p></div><label className="swarm-kb-discover-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识库" /></label></div>
        {error && !selected && <p className="swarm-kb-error" role="alert">{error}</p>}
        {loading ? <div className="swarm-kb-discover-loading"><Loader2 className="swarm-kb-spin" />正在加载公开知识库…</div> : <div className="swarm-kb-discover-content">
            {!query && featured.length > 0 && <section><div className="swarm-kb-discover-section-head"><h3>精选</h3><button type="button" onClick={() => setRotation((value) => value + 2)}><RefreshCw size={15} /> 换一换</button></div><div className="swarm-kb-discover-grid">{featured.map(renderCard)}</div></section>}
            <section><div className="swarm-kb-discover-section-head"><h3>{query ? '搜索结果' : '推荐'}</h3><span>{searching ? '正在搜索…' : `${filtered.length} 个知识库`}</span></div>{recommended.length ? <div className="swarm-kb-discover-grid">{recommended.map(renderCard)}</div> : <p className="swarm-kb-muted">{searching ? '正在搜索公开知识库…' : '没有匹配的公开知识库。'}</p>}</section>
        </div>}
        {selected && <div className="swarm-kb-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !subscribing) setSelected(null); }}><div className="swarm-kb-discover-detail" role="dialog" aria-modal="true" aria-label={selected.name}>
            <div className="swarm-kb-discover-detail-head"><div><small>开放许可文档 · {selected.source}</small><h2>{selected.name}</h2><p>{selected.description}</p></div><button type="button" aria-label="关闭" onClick={() => setSelected(null)} disabled={subscribing}><X size={19} /></button></div>
            <div className="swarm-kb-discover-records"><h3>可导入文档（最多 12 篇）</h3>{recordsLoading ? <p><Loader2 className="swarm-kb-spin" size={16} />正在读取资料…</p> : records.length ? records.map((record) => <article key={record.id}><a href={record.url} target="_blank" rel="noopener noreferrer">{record.title}<ArrowUpRight size={14} /></a><small>{record.source} · {record.license}</small><p>{record.content.slice(0, 280)}{record.content.length > 280 ? '…' : ''}</p></article>) : <p>当前没有可导入的公开文档。</p>}</div>
            {error && <p className="swarm-kb-error" role="alert">{error}</p>}
            <p className="swarm-kb-discover-cost-note">公开资料无需订阅费；导入和提问会使用你已配置的模型 API。{!embedding && ' 请先在凭证页配置 DashScope 的 Qwen3 VL Embedding。'}</p>
            <div className="swarm-kb-discover-detail-actions"><button type="button" onClick={() => setSelected(null)} disabled={subscribing}>取消</button><button className="primary" type="button" onClick={() => void subscribe()} disabled={subscribing || recordsLoading || !records.length || !embedding || isSubscribed(selected.id)}>{subscribing ? <><Loader2 className="swarm-kb-spin" size={15} /> 正在订阅并导入…</> : isSubscribed(selected.id) ? '已订阅' : '订阅并导入知识库'}</button></div>
        </div></div>}
    </main>;
}
