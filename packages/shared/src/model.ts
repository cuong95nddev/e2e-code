export type ModelId = "claude-sonnet-4-6" | "claude-opus-4-6" | "claude-haiku-4-5-20251001";

export interface ModelInfo {
  readonly id: ModelId;
  readonly displayName: string;
  readonly contextWindow: number;
}

export const MODELS: Record<ModelId, ModelInfo> = {
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    contextWindow: 200_000,
  },
  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
    contextWindow: 1_000_000,
  },
  "claude-haiku-4-5-20251001": {
    id: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    contextWindow: 200_000,
  },
};

export function getModelInfo(id: ModelId): ModelInfo {
  return MODELS[id];
}
