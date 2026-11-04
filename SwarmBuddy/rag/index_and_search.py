# -*- coding: utf-8 -*-
"""库模式 RAG 示例，无须启动 FastAPI 服务或管理器。

演示 :mod:`agentscope.rag` 的完整流程：

1. **向量库**：本示例使用内存中的 :class:`QdrantStore`；实际服务可改为 ``url=...``。
2. **解析器**：:class:`TextParser` 将原始字节转换为 ``Section``。
3. **分块器**：:class:`ApproxTokenChunker` 将章节拆分为可索引的 ``Chunk``。
4. **嵌入模型**：使用 DashScope 文本嵌入模型。
5. **知识库**：将嵌入模型、向量库和集合绑定在一起，提供文档写入、检索、
   列表及删除接口，供 :class:`RAGMiddleware` 使用。

索引流程：

    bytes ── parser ──► Section[] ── chunker ──► Chunk[]
                                                  │
                                                  ▼
                                   knowledge.insert_document(chunks)
                                                  │
                                                  ▼
                            嵌入 → 写入绑定的集合

检索时调用 ``knowledge.search(...)``，获得 ``VectorSearchResult``。

运行方式：

    DASHSCOPE_API_KEY=sk-... python examples/rag/index_and_search.py
"""
import asyncio
import os

from agentscope.credential import DashScopeCredential
from agentscope.embedding import DashScopeEmbeddingModel
from agentscope.message import TextBlock
from agentscope.rag import (
    ApproxTokenChunker,
    KnowledgeBase,
    QdrantStore,
    TextParser,
)


COLLECTION = "demo-kb"

# 将示例语料直接写为字节，避免依赖磁盘文件；实际使用时可读取上传文件或对象存储。
DOCUMENTS: dict[str, bytes] = {
    "cats.md": (
        b"# Cats\n\n"
        b"Cats are small carnivorous mammals. They are popular as pets "
        b"because of their playful and affectionate nature.\n\n"
        b"Domestic cats sleep around 12-16 hours per day. They are most "
        b"active at dawn and dusk (crepuscular behaviour).\n"
    ),
    "agentscope.md": (
        b"# AgentScope\n\n"
        b"AgentScope is a developer-centric framework for building "
        b"multi-agent LLM applications. It emphasises transparency, "
        b"controllability, and a clear separation between agent logic "
        b"and infrastructure.\n\n"
        b"Its RAG module ships a parser/chunker/embedding/vector-store "
        b"pipeline that can be wired up without the FastAPI service.\n"
    ),
}


async def build_index(
    knowledge: KnowledgeBase,
    parser: TextParser,
    chunker: ApproxTokenChunker,
) -> None:
    """依次解析、分块并写入每篇示例文档。

    ``knowledge.insert_document`` 内部负责嵌入及写入向量库；调用方只需提供分块。
    """
    for filename, file_bytes in DOCUMENTS.items():
        # 第一步：将字节解析为章节。
        sections = await parser.parse(file=file_bytes, filename=filename)

        # 第二步：将章节拆分为文本块。
        chunks = await chunker.chunk(sections)

        # 第三步：同一文档 ID 下批量嵌入分块；返回的 ID 可用于日后删除文档。
        document_id = await knowledge.insert_document(
            chunks,
            document_metadata={"filename": filename},
        )
        print(
            f"  indexed {filename!r} as document_id={document_id} "
            f"({len(chunks)} chunk(s))",
        )


async def search(
    knowledge: KnowledgeBase,
    query: str,
    top_k: int = 3,
) -> None:
    """通过知识库执行检索并打印命中结果。"""
    results = await knowledge.search(queries=[query], top_k=top_k)

    print(f"\nQuery: {query!r}")
    if not results:
        print("  (no hits)")
        return
    for rank, result in enumerate(results, start=1):
        # 只有文本块可以直接打印。
        snippet = (
            result.chunk.content.text
            if isinstance(result.chunk.content, TextBlock)
            else "<non-text chunk>"
        )
        snippet = snippet.replace("\n", " ").strip()
        if len(snippet) > 120:
            snippet = snippet[:117] + "..."
        print(
            f"  [{rank}] score={result.score:.4f} "
            f"source={result.chunk.source} "
            f"document_id={result.document_id}\n"
            f"      {snippet}",
        )


async def main() -> None:
    """示例程序入口。"""
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Set DASHSCOPE_API_KEY before running this example.",
        )

    # 这些基础组件也用于服务模式的 create_app；此处由示例代码直接调用。
    embedding_model = DashScopeEmbeddingModel(
        credential=DashScopeCredential(api_key=api_key),
        model="text-embedding-v4",
        dimensions=1024,
    )
    parser = TextParser()
    chunker = ApproxTokenChunker(chunk_size=256, overlap=32)
    store = QdrantStore(location=":memory:")

    # QdrantStore 是异步上下文管理器：进入时连接，退出时关闭。
    async with store:
        # KnowledgeBase 统一管理嵌入模型、向量库和集合；首次建索引时才创建集合。
        knowledge = KnowledgeBase(
            name="demo-kb",
            description="A toy corpus on cats and AgentScope.",
            embedding_model=embedding_model,
            vector_store=store,
            collection=COLLECTION,
        )

        print("Indexing demo corpus ...")
        await build_index(knowledge, parser, chunker)

        # 用两条查询演示相关性评分。
        await search(knowledge, "When are cats most active?")
        await search(
            knowledge,
            "What framework lets me build multi-agent apps?",
        )


if __name__ == "__main__":
    asyncio.run(main())
