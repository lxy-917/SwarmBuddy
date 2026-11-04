# -*- coding: utf-8 -*-
"""以库模式将 :class:`RAGMiddleware` 接入 :class:`Agent`。

该中间件是智能体侧的 RAG 入口：传入一个或多个
:class:`~agentscope.rag.KnowledgeBase` 后，每轮用户提问都会触发检索，
并将匹配的文本块送入模型上下文。每个知识库绑定嵌入模型和向量集合。

本示例复用 ``index_and_search.py`` 的解析、分块、嵌入、入库流程，
并将同一知识库接入两种模式的智能体：

- ``"static"``：回复开始时自动检索，将命中内容作为一次性
  :class:`HintBlock` 注入上下文。
- ``"agentic"``（默认）：暴露 ``search_knowledge`` 工具，
  由模型决定何时检索以及检索什么。

运行方式：

    DASHSCOPE_API_KEY=sk-... python examples/rag/integrate_with_agent.py
"""
import asyncio
import os

from agentscope.agent import Agent
from agentscope.credential import DashScopeCredential
from agentscope.embedding import DashScopeEmbeddingModel
from agentscope.message import UserMsg
from agentscope.middleware import RAGMiddleware
from agentscope.model import DashScopeChatModel
from agentscope.rag import (
    ApproxTokenChunker,
    KnowledgeBase,
    QdrantStore,
    TextParser,
)
from agentscope.tool import Toolkit


COLLECTION = "demo-kb"

KNOWLEDGE: dict[str, bytes] = {
    "company-policy.md": (
        b"# Acme Remote Work Policy\n\n"
        b"Employees may work remotely up to three days per week. "
        b"Wednesdays are mandatory in-office days for the whole "
        b"engineering org so cross-team syncs land on a predictable "
        b"day.\n\n"
        b"Equipment stipend: each new hire receives a USD 1,500 "
        b"one-off stipend for a home-office setup. Receipts must be "
        b"submitted within 90 days of the start date.\n"
    ),
    "release-notes.md": (
        b"# AgentScope 3.0 release notes\n\n"
        b"- New ``agentscope.rag`` module: pluggable parser, chunker, "
        b"embedding, and vector-store backends.\n"
        b"- ``RAGMiddleware`` ships in two modes -- ``static`` for "
        b"automatic injection, ``agentic`` for tool-driven search.\n"
        b"- Knowledge base service supports embedded and dedicated "
        b"worker deployments through a single message-bus channel.\n"
    ),
}


async def index_corpus(knowledge: KnowledgeBase) -> None:
    """将示例语料建立索引并写入知识库。

    流程与 ``examples/rag/index_and_search.py`` 相同。每个源文件对应
    一个逻辑文档；``KnowledgeBase.insert_document`` 批量嵌入并写入分块。
    """
    parser = TextParser()
    chunker = ApproxTokenChunker(chunk_size=256, overlap=32)
    for filename, file_bytes in KNOWLEDGE.items():
        sections = await parser.parse(file=file_bytes, filename=filename)
        chunks = await chunker.chunk(sections)
        await knowledge.insert_document(
            chunks,
            document_metadata={"filename": filename},
        )


def build_agent(
    name: str,
    *,
    chat_model: DashScopeChatModel,
    rag_mw: RAGMiddleware,
) -> Agent:
    """创建接入 RAG 中间件的 :class:`Agent`。

    RAG 只是 ``middlewares=`` 中的一项，可与工具卸载、记忆等中间件组合。
    """
    return Agent(
        name=name,
        system_prompt=(
            "You are a concise assistant. Use matched context when "
            "available; if you don't know, say so."
        ),
        model=chat_model,
        toolkit=Toolkit(),
        middlewares=[rag_mw],
    )


async def ask(agent: Agent, question: str) -> None:
    """执行一次回复并打印最终消息。"""
    print(f"\n[{agent.name}] user: {question}")
    reply = await agent.reply(UserMsg(name="user", content=question))
    print(f"[{agent.name}] assistant: {reply.get_text_content()}")


async def main() -> None:
    """示例程序入口。"""
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Set DASHSCOPE_API_KEY before running this example.",
        )

    credential = DashScopeCredential(api_key=api_key)
    chat_model = DashScopeChatModel(
        credential=credential,
        model="qwen-plus",
        stream=False,
    )
    embedding_model = DashScopeEmbeddingModel(
        credential=credential,
        model="text-embedding-v4",
        dimensions=1024,
    )

    store = QdrantStore(location=":memory:")
    async with store:
        # KnowledgeBase 将嵌入模型、向量库和集合绑定到一起；首次使用时才创建集合。
        knowledge = KnowledgeBase(
            name="acme-handbook",
            description="Acme HR policies and AgentScope 3.0 release notes.",
            embedding_model=embedding_model,
            vector_store=store,
            collection=COLLECTION,
        )

        await index_corpus(knowledge)

        # 模式一：静态检索。首次推理时自动检索；注入的 HintBlock 只用于本次模型调用。
        static_mw = RAGMiddleware(
            knowledge_bases=[knowledge],
            parameters=RAGMiddleware.Parameters(
                mode="static",
                top_k=3,
                emit_hint_event=False,
            ),
        )
        static_agent = build_agent(
            "rag-static-agent",
            chat_model=chat_model,
            rag_mw=static_mw,
        )
        await ask(
            static_agent,
            "How many remote days per week does Acme allow?",
        )

        # 模式二：智能体检索。模型自行调用 search_knowledge；绑定多个知识库时，
        # 可传入 knowledge_bases 限定检索范围。
        agentic_mw = RAGMiddleware(
            knowledge_bases=[knowledge],
            parameters=RAGMiddleware.Parameters(mode="agentic", top_k=3),
        )
        agentic_agent = build_agent(
            "rag-agentic-agent",
            chat_model=chat_model,
            rag_mw=agentic_mw,
        )
        await ask(
            agentic_agent,
            "Summarise what's new in the AgentScope 3.0 release notes.",
        )


if __name__ == "__main__":
    asyncio.run(main())
