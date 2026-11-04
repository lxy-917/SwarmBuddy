"""公开 GitHub 技能来源，以及 skills.sh 链接导入。"""

import asyncio
import io
import re
import tarfile
import time
import zipfile
from html import unescape
from urllib.parse import quote

import httpx
import yaml

from agentscope.app.hub import HubError, SkillArchive, SkillCard, SkillHubBase, SkillHubPage


_SKILL_LINE = re.compile(
    r"^- \[(?P<title>[^]]+)\]\(https://raw\.githubusercontent\.com/"
    r"github/awesome-copilot/main/(?P<path>skills/[^)]+)/SKILL\.md\):\s*(?P<description>.*)$",
)
_MAX_ARCHIVE = 30 * 1024 * 1024
_MAX_SKILL_BYTES = 12 * 1024 * 1024


def _public_install_counts(html: str, owner: str, repo: str) -> dict[str, tuple[int, str]]:
    """从 skills.sh 公开仓库页读取单个技能的安装量。缩写数字仅作近似排序。"""
    prefix = re.escape(f"/{owner}/{repo}/")
    pattern = re.compile(
        r'<a\b[^>]*href="' + prefix + r'([^"/?#]+)"[^>]*>\s*'
        r'<div[^>]*>\s*<h3[^>]*>[^<]*</h3>\s*</div>\s*'
        r'<div[^>]*>\s*<span[^>]*>([^<]+)</span>',
        re.S,
    )
    counts = {}
    for slug, label in pattern.findall(html):
        shown = label.strip()
        match = re.fullmatch(r"([\d,.]+)([KM]?)", shown, re.I)
        if not match:
            continue
        multiplier = {"": 1, "K": 1000, "M": 1000000}[match[2].upper()]
        counts[slug] = (round(float(match[1].replace(",", "")) * multiplier), shown)
    return counts


def _frontmatter(text: str) -> dict:
    if not text.startswith("---\n"):
        return {}
    marker = text.find("\n---", 4)
    if marker < 0 or marker > 65536:
        return {}
    try:
        value = yaml.safe_load(text[4:marker])
    except yaml.YAMLError:
        return {}
    return value if isinstance(value, dict) else {}


class PublicGitHubSkillHub(SkillHubBase):
    """从公开仓库列出技能，并把完整技能目录打包供项目安装。"""

    def __init__(self, hub_id: str, display_name: str, owner: str, repo: str,
                 root: str | None, description: str, index_url: str | None = None):
        super().__init__(hub_id, display_name, description, f"https://github.com/{owner}.png")
        self.owner, self.repo, self.root, self.index_url = owner, repo, root, index_url
        self._client: httpx.AsyncClient | None = None
        self._catalog: list[SkillCard] | None = None
        self._archive: bytes | None = None
        self._updated = 0.0
        self._lock = asyncio.Lock()

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=60, follow_redirects=True)
        return self

    async def __aexit__(self, *exc):
        if self._client:
            await self._client.aclose()
            self._client = None

    def _http(self):
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=60, follow_redirects=True)
        return self._client

    async def _get(self, url: str) -> bytes:
        try:
            response = await self._http().get(url, headers={"User-Agent": "SwarmBuddy-SkillHub"})
        except httpx.HTTPError as exc:
            raise HubError(self.hub_id, 503, f"无法连接公开技能来源：{exc}") from exc
        if response.status_code == 404:
            raise KeyError(url)
        if response.status_code >= 400:
            raise HubError(self.hub_id, response.status_code, response.text[:300])
        return response.content

    async def _load_catalog(self) -> list[SkillCard]:
        if self._catalog is not None and time.monotonic() - self._updated < 900:
            return self._catalog
        async with self._lock:
            if self._catalog is not None and time.monotonic() - self._updated < 900:
                return self._catalog
            if self.index_url:
                # Awesome Copilot 官方索引完整列出数百个技能，避免下载百兆仓库。
                source = (await self._get(self.index_url)).decode("utf-8")
                cards = []
                for line in source.splitlines():
                    match = _SKILL_LINE.match(line)
                    if match:
                        path = match["path"]
                        cards.append(self._card(path, match["title"], match["description"]))
            else:
                url = f"https://codeload.github.com/{self.owner}/{self.repo}/zip/refs/heads/main"
                archive = await self._get(url)
                if len(archive) > _MAX_ARCHIVE:
                    raise HubError(self.hub_id, 413, "公开仓库压缩包过大，无法列出技能")
                self._archive = archive
                with zipfile.ZipFile(io.BytesIO(archive)) as zf:
                    paths = sorted({
                        name.split("/", 1)[1].removesuffix("/SKILL.md")
                        for name in zf.namelist()
                        if name.endswith("/SKILL.md") and "/" in name
                    })
                    cards = []
                    for path in paths:
                        is_root_skill = bool(self.root and path.startswith(self.root + "/")
                                             and path.count("/") == self.root.count("/") + 1)
                        is_microsoft_plugin = (self.owner == "microsoft"
                                               and path.startswith(".github/plugins/") and "/skills/" in path)
                        if not (is_root_skill or is_microsoft_plugin):
                            continue
                        metadata = _frontmatter(zf.read(f"{self.repo}-main/{path}/SKILL.md").decode("utf-8-sig"))
                        description = str(metadata.get("description") or "").strip()
                        cards.append(self._card(path, description=description))
            # GitHub 只提供仓库 Star；公开的 skills.sh 仓库页则给出单技能安装量。
            # 读取失败时保留目录，缺失值继续为 None，不把它冒充为 0。
            try:
                page = (await self._get(f"https://www.skills.sh/{self.owner}/{self.repo}")).decode("utf-8")
                counts = _public_install_counts(page, self.owner, self.repo)
            except (HubError, KeyError, UnicodeError):
                counts = {}
            if counts:
                cards = [
                    card.model_copy(update={
                        "installs": counts[card.name][0],
                        "metadata": {**card.metadata, "install_label": counts[card.name][1]},
                    }) if card.name in counts else card
                    for card in cards
                ]
            self._catalog, self._updated = cards, time.monotonic()
            return cards

    def _card(self, path: str, title: str | None = None, description: str = "", markdown: str | None = None):
        name = path.rsplit("/", 1)[-1]
        return SkillCard(
            hub_id=self.hub_id, id=path, name=name, display_name=title or name,
            description=description, markdown=markdown, author=self.owner,
            url=f"https://github.com/{self.owner}/{self.repo}/tree/main/{path}",
            icon_url=f"https://github.com/{self.owner}.png",
        )

    async def list_skills(self, user_id: str, q: str | None = None, cursor: str | None = None,
                          limit: int = 20, sort: str = "updated") -> SkillHubPage:
        cards = await self._load_catalog()
        if q:
            needle = q.casefold()
            cards = [card for card in cards if needle in card.name.casefold()
                     or needle in card.description.casefold()]
        if sort == "installs":
            cards = sorted(cards, key=lambda card: (card.installs is None, -(card.installs or 0), card.name.casefold()))
        else:
            cards = sorted(cards, key=lambda card: card.name.casefold())
        try:
            offset = max(0, int(cursor or 0))
        except ValueError:
            offset = 0
        batch = cards[offset:offset + limit]
        next_cursor = str(offset + limit) if offset + limit < len(cards) else None
        return SkillHubPage(cards=batch, next_cursor=next_cursor)

    async def _skill_text(self, path: str) -> str:
        url = f"https://raw.githubusercontent.com/{self.owner}/{self.repo}/main/{quote(path)}/SKILL.md"
        return (await self._get(url)).decode("utf-8-sig")

    async def get_skill(self, user_id: str, card_id: str) -> SkillCard:
        cards = await self._load_catalog()
        card = next((item for item in cards if item.id == card_id), None)
        if card is None:
            raise KeyError(card_id)
        text = await self._skill_text(card_id)
        description = card.description
        name = card.name
        # YAML 顶部元数据只提取展示字段，原始文件在安装时保持不变。
        metadata = _frontmatter(text)
        if metadata.get("name"):
            name = str(metadata["name"]).strip()
        if metadata.get("description"):
            description = str(metadata["description"]).strip()
        return card.model_copy(update={"name": name, "description": description, "markdown": text})

    async def _files_from_archive(self, path: str) -> dict[str, bytes]:
        await self._load_catalog()
        if self._archive is None:
            raise HubError(self.hub_id, 503, "仓库压缩包不可用")
        files = {}
        with zipfile.ZipFile(io.BytesIO(self._archive)) as zf:
            prefix = f"{self.repo}-main/{path}/"
            for info in zf.infolist():
                if info.is_dir() or not info.filename.startswith(prefix):
                    continue
                relative = info.filename[len(prefix):]
                if not relative or ".." in relative.split("/"):
                    continue
                if sum(len(v) for v in files.values()) + info.file_size > _MAX_SKILL_BYTES:
                    raise HubError(self.hub_id, 413, "技能目录过大")
                files[relative] = zf.read(info)
        return files

    async def _files_from_github(self, path: str) -> dict[str, bytes]:
        # GitHub 页面提供目录链接；仅访问所选技能目录，避免整仓下载。
        pending = [path]
        seen = set()
        files: dict[str, bytes] = {}
        while pending:
            folder = pending.pop()
            if folder in seen or len(seen) > 30:
                continue
            seen.add(folder)
            page = (await self._get(f"https://github.com/{self.owner}/{self.repo}/tree/main/{quote(folder)}")).decode("utf-8")
            prefix = f"/{self.owner}/{self.repo}/"
            links = {unescape(link) for link in re.findall(r'href="(' + re.escape(prefix) + r'(?:blob|tree)/main/[^"]+)"', page)}
            for link in links:
                kind, item = link[len(prefix):].split("/main/", 1)
                if not item.startswith(folder + "/") or item == folder:
                    continue
                # 目录页只处理直属子项，防止站点导航中的其他链接混入。
                relative_to_folder = item[len(folder) + 1:]
                if "/" in relative_to_folder:
                    continue
                if kind == "tree":
                    pending.append(item)
                else:
                    relative = item[len(path) + 1:]
                    data = await self._get(f"https://raw.githubusercontent.com/{self.owner}/{self.repo}/main/{quote(item)}")
                    files[relative] = data
                    if sum(len(v) for v in files.values()) > _MAX_SKILL_BYTES:
                        raise HubError(self.hub_id, 413, "技能目录过大")
        return files

    async def download(self, user_id: str, card_id: str, version: str | None = None) -> SkillArchive:
        await self.get_skill(user_id, card_id)
        files = (await self._files_from_github(card_id)) if self.index_url else (await self._files_from_archive(card_id))
        if "SKILL.md" not in files:
            raise HubError(self.hub_id, 422, "技能目录缺少 SKILL.md")
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w") as archive:
            root = card_id.rsplit("/", 1)[-1]
            for relative, data in files.items():
                info = tarfile.TarInfo(f"{root}/{relative}")
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        async def chunks():
            yield output.getvalue()
        return SkillArchive(format="tar", stream=chunks())


class SkillsShLinkHub(PublicGitHubSkillHub):
    """skills.sh 的公开链接导入；目录 API 需要 Vercel OIDC，不能匿名枚举。"""

    def __init__(self):
        super().__init__("skills-sh", "skills.sh", "", "", None,
                         "浏览 skills.sh 后粘贴公开技能链接，即可安装到项目")
        self.icon_url = "https://skills.sh/favicon.ico"

    async def list_skills(self, user_id: str, q: str | None = None, cursor: str | None = None,
                          limit: int = 20, sort: str = "updated") -> SkillHubPage:
        return SkillHubPage(cards=[], next_cursor=None)

    async def _resolve(self, card_id: str):
        parts = card_id.strip("/").split("/")
        if len(parts) != 3 or not all(re.fullmatch(r"[\w.-]+", p) for p in parts):
            raise KeyError(card_id)
        owner, repo, slug = parts
        source = PublicGitHubSkillHub(self.hub_id, self.display_name, owner, repo, None, self.description)
        async with source:
            for path in (f"skills/{slug}", f".github/skills/{slug}",
                         f".agents/skills/{slug}", f".claude/skills/{slug}", slug):
                try:
                    text = await source._skill_text(path)
                    return source, path, text
                except KeyError:
                    continue
        raise KeyError(card_id)

    async def get_skill(self, user_id: str, card_id: str) -> SkillCard:
        source, path, text = await self._resolve(card_id)
        return source._card(path, markdown=text).model_copy(update={"id": card_id})

    async def download(self, user_id: str, card_id: str, version: str | None = None) -> SkillArchive:
        source, path, _ = await self._resolve(card_id)
        async with source:
            files = await source._files_from_github(path)
        if "SKILL.md" not in files:
            raise HubError(self.hub_id, 422, "技能目录缺少 SKILL.md")
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w") as archive:
            for relative, data in files.items():
                info = tarfile.TarInfo(f"{path.rsplit('/', 1)[-1]}/{relative}")
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        async def chunks():
            yield output.getvalue()
        return SkillArchive(format="tar", stream=chunks())
