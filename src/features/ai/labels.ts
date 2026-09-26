import type { AiProviderKind, AiRule, AiTask } from "../../ipc";

export const KIND_LABELS: Record<AiProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
  lmstudio: "LM Studio (local)",
  custom: "OpenAI-compatible endpoint",
};

export const TASK_LABELS: Record<AiTask, string> = {
  handwriting: "Handwriting",
  diagrams: "Diagrams",
  textFixes: "Text fixes",
  chat: "Chat and other",
};

export const RULE_LABELS: Record<AiRule, string> = {
  any: "Allowed",
  local: "Local models only",
  never: "Never",
};
