"""供应用内浏览器使用的只读网页搜索适配器。"""

import asyncio
import html
import re
from urllib.parse import urlparse
from xml.etree import ElementTree

import httpx


def _plain(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", value))).strip()


def _safe_link(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


async def _instant_answers(client: httpx.AsyncClient, query: str) -> list[dict[str, str]]:
    response = await client.get(
        "https://api.duckduckgo.com/",
        params={"q": query, "format": "json", "no_redirect": "1", "no_html": "1"},
    )
    response.raise_for_status()
    payload = response.json()
    results: list[dict[str, str]] = []
    abstract_url = payload.get("AbstractURL", "")
    if _safe_link(abstract_url) and payload.get("AbstractText"):
        results.append({
            "title": _plain(payload.get("Heading") or query),
            "url": abstract_url,
            "description": _plain(payload["AbstractText"]),
            "source": "DuckDuckGo",
        })

    def add_topics(topics: list, limit: int = 8) -> None:
        for item in topics:
            if len(results) >= limit:
                return
            if "Topics" in item:
                add_topics(item["Topics"], limit)
            elif _safe_link(item.get("FirstURL", "")) and item.get("Text"):
                text = _plain(item["Text"])
                if query.lower() not in text.lower():
                    continue
                results.append({
                    "title": text.split(" - ", 1)[0][:120],
                    "url": item["FirstURL"],
                    "description": text[:360],
                    "source": "DuckDuckGo",
                })

    add_topics(payload.get("RelatedTopics") or [])
    return results


async def _bing_results(client: httpx.AsyncClient, query: str) -> list[dict[str, str]]:
    response = await client.get(
        "https://www.bing.com/search",
        params={"q": query, "format": "rss"},
    )
    response.raise_for_status()
    root = ElementTree.fromstring(response.content[:2_000_000])
    results: list[dict[str, str]] = []
    words = [word.lower() for word in re.split(r"\s+", query) if len(word) > 1]
    for item in root.findall("./channel/item"):
        title = _plain(item.findtext("title") or "")
        url = item.findtext("link") or ""
        description = _plain(item.findtext("description") or "")
        if not title or not _safe_link(url):
            continue
        # 部分公开搜索源会返回无关的缓存页面，应丢弃该结果。
        haystack = f"{title} {description} {url}".lower()
        if words and not any(word in haystack for word in words):
            continue
        results.append({"title": title, "url": url, "description": description, "source": "Bing"})
        if len(results) >= 12:
            break
    return results


async def _news_results(client: httpx.AsyncClient, query: str) -> list[dict[str, str]]:
    response = await client.get(
        "https://news.google.com/rss/search",
        params={"q": query, "hl": "zh-CN", "gl": "CN", "ceid": "CN:zh-Hans"},
    )
    response.raise_for_status()
    root = ElementTree.fromstring(response.content[:2_000_000])
    results: list[dict[str, str]] = []
    for item in root.findall("./channel/item")[:8]:
        title = _plain(item.findtext("title") or "")
        url = item.findtext("link") or ""
        description = _plain(item.findtext("description") or "")
        if title and _safe_link(url):
            results.append({"title": title, "url": url, "description": description, "source": "新闻"})
    return results


async def search_web(query: str) -> list[dict[str, str]]:
    async with httpx.AsyncClient(
        timeout=12,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; SwarmBuddyBrowser/1.0)"},
    ) as client:
        responses = await asyncio.gather(
            _bing_results(client, query), _instant_answers(client, query), _news_results(client, query),
            return_exceptions=True,
        )
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, response in enumerate(responses):
        if isinstance(response, BaseException):
            continue
        if index == 2 and len(results) >= 5:
            continue
        for result in response:
            if result["url"] not in seen:
                results.append(result)
                seen.add(result["url"])
    return results[:15]
