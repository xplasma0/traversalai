import { buildAgentMainSessionKey } from "../../../src/routing/session-key.js";

export type ModelChoice = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
};

export function formatModelLabel(model: ModelChoice): string {
  const provider = model.provider.trim();
  const name = model.name.trim() || model.id;
  return provider ? `${name} (${provider})` : name;
}

export function cycleModelId(
  models: ModelChoice[],
  currentId: string,
  direction: "next" | "prev",
): string {
  if (models.length === 0) {
    return "";
  }
  const index = models.findIndex((entry) => entry.id === currentId);
  const start = index >= 0 ? index : 0;
  const delta = direction === "next" ? 1 : -1;
  const nextIndex = (start + delta + models.length) % models.length;
  return models[nextIndex]?.id ?? models[0].id;
}

export function resolveAgentSessionKey(agentId: string, mainKey?: string): string {
  return buildAgentMainSessionKey({ agentId, mainKey });
}
