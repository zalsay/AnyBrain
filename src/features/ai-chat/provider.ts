import type { AiModelConfig, AiProviderSettings } from '../../types/app';

export const AI_MODEL_CONTEXT_DEFAULT = '200k';

export function createAiModelConfig(modelId = '', contextLength = AI_MODEL_CONTEXT_DEFAULT): AiModelConfig {
  return {
    id: `ai-model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    modelId,
    contextLength,
  };
}

export function normalizeAiProviderSettings(
  value?: Partial<AiProviderSettings> & { models?: Array<Partial<AiModelConfig>> }
): AiProviderSettings {
  const models = Array.isArray(value?.models)
    ? value.models.map((model, index) => ({
      id: model?.id?.trim() || `ai-model-${index}-${Math.random().toString(36).slice(2, 8)}`,
      modelId: model?.modelId?.trim() || '',
      contextLength: model?.contextLength?.trim() || AI_MODEL_CONTEXT_DEFAULT,
    }))
    : [];

  return {
    enabled: Boolean(value?.enabled),
    baseUrl: value?.baseUrl?.trim() || '',
    apiKey: value?.apiKey?.trim() || '',
    modelId: value?.modelId?.trim() || models.find(model => model.modelId)?.modelId || '',
    compressionModelId: value?.compressionModelId?.trim() || '',
    models: models.length > 0 ? models : [createAiModelConfig()],
  };
}
