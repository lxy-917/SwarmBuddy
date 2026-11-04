import type { DimensionPolicy, EmbeddingModelConfig, KbEmbeddingProvider } from '@/api';

export const KNOWLEDGE_EMBEDDING_MODEL = 'qwen3-vl-embedding';

/** 沿用服务商默认向量维度；当前多模态调用不会覆盖该设置。 */
export function qwen3VlEmbeddingConfig(
    providers: KbEmbeddingProvider[],
    policy: DimensionPolicy | null,
    preferredCredentialId?: string,
): EmbeddingModelConfig | null {
    const candidates = [...providers].sort((a, b) =>
        Number(b.credential.id === preferredCredentialId) - Number(a.credential.id === preferredCredentialId),
    );
    for (const provider of candidates) {
        if (provider.credential.data.type !== 'dashscope_credential') continue;
        const model = provider.models.find((card) => card.name === KNOWLEDGE_EMBEDDING_MODEL && card.status === 'active');
        if (!model || (policy?.dimension != null && policy.dimension !== model.dimensions)) continue;
        return {
            type: 'dashscope_credential',
            credential_id: provider.credential.id,
            model: model.name,
            dimensions: model.dimensions,
            parameters: {},
        };
    }
    return null;
}
