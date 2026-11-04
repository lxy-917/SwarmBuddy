import { ArrowLeft, ArrowRight, Compass, Globe2, Plus, RotateCw, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { client } from '@/api/client';
import './browser.css';

type BrowserTab = { id: string; title: string; history: string[]; position: number; reload: number };
type WebResult = { title: string; url: string; description: string; source: string };
type SearchResponse = { query: string; results: WebResult[] };

const newTab = (): BrowserTab => ({ id: crypto.randomUUID(), title: '新标签页', history: [], position: -1, reload: 0 });

function resolveAddress(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text) || /^[^\s/]+\.[^\s]+/.test(text)) {
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
    } catch { /* Fall through to search. */ }
  }
  return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
}

function searchTerm(url: string | null): string | null {
  if (!url) return null;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if ((host === 'bing.com' || host.endsWith('.bing.com')) && parsed.pathname === '/search') return parsed.searchParams.get('q');
  if ((host === 'baidu.com' || host.endsWith('.baidu.com')) && parsed.pathname === '/s') return parsed.searchParams.get('wd');
  return null;
}

function tabTitle(url: string): string {
  const term = searchTerm(url);
  return term ? `${term} - 搜索` : new URL(url).hostname.replace(/^www\./, '');
}

export function BrowserPage() {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [newTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [draft, setDraft] = useState('');
  const [resultDraft, setResultDraft] = useState('');
  const [results, setResults] = useState<WebResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const addressRef = useRef<HTMLInputElement>(null);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const currentUrl = active.history[active.position] ?? null;
  const query = searchTerm(currentUrl);

  useEffect(() => { setDraft(currentUrl ?? ''); }, [activeId, currentUrl]);
  useEffect(() => { setResultDraft(query ?? ''); }, [query]);
  useEffect(() => {
    if (!query) { setResults([]); setSearchLoading(false); setSearchError(''); return; }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError('');
    client.get<SearchResponse>('/browser/search', { query }, { silent: true, timeoutMs: 20000 })
      .then((response) => { if (!cancelled) setResults(response.results); })
      .catch(() => { if (!cancelled) { setResults([]); setSearchError('搜索暂时不可用，请稍后重试。'); } })
      .finally(() => { if (!cancelled) setSearchLoading(false); });
    return () => { cancelled = true; };
  }, [query, active.reload]);
  useEffect(() => {
    const focusAddress = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        addressRef.current?.focus();
        addressRef.current?.select();
      }
    };
    window.addEventListener('keydown', focusAddress);
    return () => window.removeEventListener('keydown', focusAddress);
  }, []);

  const addTab = () => {
    const tab = newTab();
    setTabs((items) => [...items, tab]);
    setActiveId(tab.id);
    requestAnimationFrame(() => addressRef.current?.focus());
  };
  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const remaining = tabs.filter((tab) => tab.id !== id);
    if (!remaining.length) {
      const replacement = newTab();
      setTabs([replacement]);
      setActiveId(replacement.id);
      return;
    }
    setTabs(remaining);
    if (id === activeId) setActiveId(remaining[Math.max(0, index - 1)]?.id ?? remaining[0].id);
  };
  const navigateTo = (raw: string) => {
    const url = resolveAddress(raw);
    if (!url) return;
    setTabs((items) => items.map((tab) => tab.id === activeId ? {
      ...tab,
      title: tabTitle(url),
      history: [...tab.history.slice(0, tab.position + 1), url],
      position: tab.position + 1,
      reload: 0,
    } : tab));
    setDraft(url);
  };
  const moveHistory = (step: number) => {
    setTabs((items) => items.map((tab) => {
      if (tab.id !== activeId) return tab;
      const position = Math.max(0, Math.min(tab.history.length - 1, tab.position + step));
      return { ...tab, position, title: tabTitle(tab.history[position]), reload: 0 };
    }));
  };
  const reload = () => setTabs((items) => items.map((tab) => tab.id === activeId ? { ...tab, reload: tab.reload + 1 } : tab));

  return <div className="swarm-browser-page">
    <aside className="swarm-browser-tabs" aria-label="浏览标签页">
      <div className="swarm-browser-tabs-heading"><h2>浏览</h2><p>搜索网页或输入网址</p></div>
      <button className="swarm-browser-new-tab" type="button" onClick={addTab}><Plus size={17} />新建标签页</button>
      <div className="swarm-browser-tab-list">{tabs.map((tab) => <div className={`swarm-browser-tab ${tab.id === activeId ? 'active' : ''}`} key={tab.id}>
        <button type="button" className="swarm-browser-tab-select" onClick={() => setActiveId(tab.id)} title={tab.title}><Globe2 size={16} /><span>{tab.title}</span></button>
        <button type="button" className="swarm-browser-tab-close" onClick={() => closeTab(tab.id)} aria-label={`关闭${tab.title}`}><X size={15} /></button>
      </div>)}</div>
    </aside>
    <main className="swarm-browser-main">
      <div className="swarm-browser-toolbar">
        <button type="button" aria-label="后退" title="后退" disabled={active.position <= 0} onClick={() => moveHistory(-1)}><ArrowLeft size={18} /></button>
        <button type="button" aria-label="前进" title="前进" disabled={active.position >= active.history.length - 1} onClick={() => moveHistory(1)}><ArrowRight size={18} /></button>
        <button type="button" aria-label="刷新" title="刷新" disabled={!currentUrl} onClick={reload}><RotateCw size={18} /></button>
        <form className="swarm-browser-address" onSubmit={(event) => { event.preventDefault(); navigateTo(draft); }}><Search size={17} /><input ref={addressRef} aria-label="搜索或输入网址" placeholder="搜索或输入网址" value={draft} onChange={(event) => setDraft(event.target.value)} /></form>
      </div>
      {!currentUrl ? <div className="swarm-browser-start"><div className="swarm-browser-brand"><Compass size={34} /><h1>浏览</h1></div><form className="swarm-browser-search" onSubmit={(event) => { event.preventDefault(); navigateTo(draft); }}><input aria-label="搜索或输入网址" placeholder="搜索或输入网址" value={draft} onChange={(event) => setDraft(event.target.value)} /><button type="submit" aria-label="搜索"><Search size={21} /></button></form><p>搜索网页，或直接输入网址</p></div> : query !== null ? <section className="swarm-browser-results" aria-label="网页搜索结果"><div className="swarm-browser-results-header"><div className="swarm-browser-results-logo"><Search size={20} />网页搜索</div><form onSubmit={(event) => { event.preventDefault(); navigateTo(resultDraft); }}><input aria-label="搜索关键词" value={resultDraft} onChange={(event) => setResultDraft(event.target.value)} /><button type="submit" aria-label="搜索"><Search size={21} /></button></form></div><div className="swarm-browser-results-content"><div className="swarm-browser-results-tabs"><strong>全部</strong><span>网页</span></div>{searchLoading ? <p className="swarm-browser-results-status">正在搜索…</p> : searchError ? <p className="swarm-browser-results-status">{searchError}</p> : results.length === 0 ? <p className="swarm-browser-results-status">没有找到相关结果，试试其他关键词。</p> : <><p className="swarm-browser-results-count">找到 {results.length} 条相关结果</p>{results.map((result) => <article className="swarm-browser-result" key={result.url}><div className="swarm-browser-result-source"><Globe2 size={18} /><span>{new URL(result.url).hostname}</span><small>{result.source}</small></div><button type="button" onClick={() => navigateTo(result.url)}>{result.title}</button><p>{result.description}</p></article>)}</>}</div></section> : <div className="swarm-browser-frame"><iframe key={`${active.id}-${active.position}-${active.reload}`} src={currentUrl} title={active.title} referrerPolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin" /><div className="swarm-browser-frame-hint">此网页可能限制嵌入，无法显示时可返回搜索结果查看其他内容。</div></div>}
    </main>
  </div>;
}
