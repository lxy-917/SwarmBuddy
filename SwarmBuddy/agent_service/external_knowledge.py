"""发现 GitHub 上可复用的公开文档仓库。

仅允许导入明确标注可复用许可证的仓库文档。这里收录真实文档集合，
不把研究主题伪装成知识库。
"""

import asyncio
import base64
import os
import re
import time
from urllib.parse import quote

import httpx


ALLOWED_LICENSES = {"CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "MIT"}
DOCUMENT_EXTENSIONS = (".md", ".mdx", ".rst", ".txt")
REPO_ID = re.compile(r"^github:([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$")
CATALOG = [
    {"id": "github:workswithagents/specs", "name": "AI Agent 协作规范", "description": "Agent 发现、身份、通信、协作与信任的开放规范。", "icon": "bot", "source": "GitHub · Works With Agents"},
    {"id": "github:agent-manifest/agent-manifest", "name": "AI Agent 身份与能力规范", "description": "Agent 身份、能力声明与互操作文档。", "icon": "network", "source": "GitHub · Agent Manifest"},
    {"id": "github:Code-dot-mil/AI4SDLC", "name": "公开国防 AI 开发指南", "description": "美国国防部门公开的生成式 AI 软件开发流程与治理指南。", "icon": "shield", "source": "GitHub · Code.mil"},
    {"id": "github:ros2/ros2_documentation", "name": "ROS 2 官方文档", "description": "机器人系统、通信与导航文档", "icon": "radar", "source": "GitHub · ROS"},
    {"id": "github:OWASP/CheatSheetSeries", "name": "OWASP 安全知识库", "description": "应用安全实践与技术指南", "icon": "shield", "source": "GitHub · OWASP"},
    {"id": "github:reactjs/react.dev", "name": "React 官方文档", "description": "React 开发、组件与 API 文档", "icon": "network", "source": "GitHub · React"},
    {"id": "github:github/copilot-docs", "name": "GitHub Copilot 文档", "description": "AI 编程助手的公开使用文档", "icon": "bot", "source": "GitHub · GitHub"},
    {"id": "github:NFDI4Microbiota/nfdi4microbiota-knowledge-base", "name": "微生物研究知识库", "description": "微生物数据管理与科研知识", "icon": "waves", "source": "GitHub · NFDI4Microbiota"},
    {"id": "github:Open-Data-Product-Initiative/odps-knowledge-base", "name": "开放数据产品知识库", "description": "数据产品方法与开放实践", "icon": "route", "source": "GitHub · Open Data Product Initiative"},
]

_search_cache: dict[str, tuple[float, list[dict]]] = {}


def _github_client() -> httpx.AsyncClient:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "SwarmBuddy/1.0"}
    if token := os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    return httpx.AsyncClient(timeout=20, headers=headers, proxy=os.getenv("GITHUB_PROXY") or None, trust_env=False)


def _collection(repo: dict) -> dict | None:
    license_id = (repo.get("license") or {}).get("spdx_id")
    if license_id not in ALLOWED_LICENSES or repo.get("private") or repo.get("archived"):
        return None
    full_name = repo.get("full_name", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", full_name):
        return None
    return {
        "id": f"github:{full_name}",
        "name": repo.get("name") or full_name,
        "description": (repo.get("description") or "公开文档知识库")[:180],
        "icon": "network",
        "source": f"GitHub · {repo.get('owner', {}).get('login') or full_name.split('/')[0]}",
    }


async def search_catalog(query: str) -> list[dict]:
    """查找真实的公开文档仓库，不生成虚构主题。"""
    search = query.strip()[:100]
    if not search:
        return []
    cached = _search_cache.get(search.lower())
    if cached and time.monotonic() - cached[0] < 300:
        return cached[1]
    params = {
        "q": f"{search} in:name,description,readme license:cc-by-4.0 archived:false",
        "sort": "best-match",
        "per_page": "30",
    }
    async with _github_client() as client:
        response = await client.get("https://api.github.com/search/repositories", params=params)
        response.raise_for_status()
    results = [item for repo in response.json().get("items", []) if (item := _collection(repo))]
    _search_cache[search.lower()] = (time.monotonic(), results)
    return results


def _repo_name(collection_id: str) -> str:
    match = REPO_ID.fullmatch(collection_id)
    if not match:
        raise KeyError(collection_id)
    return f"{match.group(1)}/{match.group(2)}"


def _document_paths(tree: list[dict], limit: int) -> list[dict]:
    paths = []
    for entry in tree:
        path = entry.get("path", "")
        lower = path.lower()
        if entry.get("type") != "blob" or not lower.endswith(DOCUMENT_EXTENSIONS):
            continue
        if entry.get("size", 0) > 80_000 or any(segment in lower.split("/") for segment in (".github", "node_modules", "test", "tests", "translations", "locales")):
            continue
        paths.append(entry)
    def rank(entry: dict) -> tuple[int, int, str]:
        path = entry["path"]
        lower = path.lower()
        name = lower.rsplit("/", 1)[-1]
        priority = 0 if lower == "readme.md" else 1 if lower in ("index.md", "docs/index.md") else 2 if lower.startswith(("docs/plays/", "docs/", "source/", "cheatsheets/", "src/content/learn/")) else 3 if "/" not in path else 4
        return (priority, path.count("/"), lower)
    return sorted(paths, key=rank)[:limit]


async def fetch_records(collection_id: str, limit: int = 12) -> list[dict]:
    full_name = _repo_name(collection_id)
    async with _github_client() as client:
        repo_response = await client.get(f"https://api.github.com/repos/{full_name}")
        if repo_response.status_code == 404:
            raise KeyError(collection_id)
        repo_response.raise_for_status()
        repo = repo_response.json()
        if not _collection(repo):
            raise ValueError("该知识库未提供允许导入的开放许可，或已不可用")
        branch = repo.get("default_branch") or "main"
        tree_response = await client.get(f"https://api.github.com/repos/{full_name}/git/trees/{quote(branch, safe='')}", params={"recursive": "1"})
        tree_response.raise_for_status()
        tree = tree_response.json()
        if tree.get("truncated"):
            raise ValueError("该知识库文档过多，暂时无法完整读取目录")
        paths = _document_paths(tree.get("tree", []), min(max(limit, 1), 20))
        semaphore = asyncio.Semaphore(3)
        async def read(entry: dict) -> dict | None:
            path = entry["path"]
            url = f"https://api.github.com/repos/{full_name}/git/blobs/{entry['sha']}"
            async with semaphore:
                try:
                    response = await client.get(url, timeout=12)
                except httpx.HTTPError:
                    return None
            if response.status_code != 200:
                return None
            blob = response.json()
            if blob.get("encoding") != "base64":
                return None
            try:
                content = base64.b64decode(blob["content"]).decode("utf-8", errors="replace").strip()
            except (KeyError, ValueError):
                return None
            if len(content) < 80:
                return None
            return {
                "id": f"{repo['id']}-{path}",
                "title": path.rsplit("/", 1)[-1],
                "content": content[:50_000],
                "authors": [],
                "year": None,
                "url": f"https://github.com/{full_name}/blob/{quote(branch, safe='')}/{quote(path, safe='/')}",
                "source": full_name,
                "license": repo["license"]["spdx_id"],
            }
        records = await asyncio.gather(*(read(entry) for entry in paths))
    return [record for record in records if record]
