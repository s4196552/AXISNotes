import type {
  AiLogEntry,
  AiModel,
  AiProviderConfig,
  AiProviderKind,
  AiProviderStatus,
  AiRule,
  AiRunRequest,
  AiRunResult,
  AiSettings,
  AiSettingsView,
  AiTask,
  Backend,
  BackendError,
  ErrorCode,
} from "./types";

// In-memory stand-in for the Rust AI layer (unit tests and browser dev). It mirrors the
// real rules — privacy, keys, task defaults, fallback — and "answers" by streaming an
// echo of the prompt, so the UI can be exercised without any provider.

type AiBackend = Pick<
  Backend,
  | "aiSettings"
  | "aiSaveSettings"
  | "aiSetKey"
  | "aiDeleteKey"
  | "aiTestProvider"
  | "aiListModels"
  | "aiPlan"
  | "aiRun"
  | "aiCancel"
  | "aiLog"
>;

const fail = (code: ErrorCode, message: string): never => {
  throw { code, message } satisfies BackendError;
};

const DEFAULT_URL: Record<AiProviderKind, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  custom: "",
};

const MODELS: Partial<Record<AiProviderKind, AiModel[]>> = {
  openai: [
    { id: "gpt-6-astra", name: "GPT-6 Astra", vision: true, json: true, context: null },
    { id: "gpt-6-sol", name: "GPT-6 Sol", vision: true, json: true, context: 272000 },
    { id: "gpt-6-luna", name: "GPT-6 Luna", vision: false, json: true, context: null },
  ],
  anthropic: [
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", vision: true, json: true, context: null },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", vision: true, json: true, context: null },
    {
      id: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      vision: true,
      json: true,
      context: null,
    },
  ],
  gemini: [
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", vision: true, json: true, context: null },
    { id: "gemini-3.1-flash", name: "Gemini 3.1 Flash", vision: true, json: true, context: null },
  ],
  ollama: [
    { id: "llama3.3", name: "llama3.3", vision: false, json: false, context: null },
    { id: "qwen2.5vl:7b", name: "qwen2.5vl:7b", vision: true, json: false, context: null },
  ],
};

const DEFAULTS: Partial<Record<AiProviderKind, Partial<Record<AiTask, string>>>> = {
  openai: {
    diagrams: "gpt-6-astra",
    handwriting: "gpt-6-sol",
    textFixes: "gpt-6-luna",
    chat: "gpt-6-sol",
  },
  anthropic: {
    diagrams: "claude-opus-5-5",
    handwriting: "claude-sonnet-5",
    textFixes: "claude-haiku-4-5-20251001",
    chat: "claude-sonnet-5",
  },
};

const modelsFor = (kind: AiProviderKind): AiModel[] =>
  MODELS[kind] ?? [
    { id: "demo-model", name: "demo-model", vision: false, json: false, context: null },
  ];

const requiresKey = (k: AiProviderKind) =>
  k === "openai" || k === "anthropic" || k === "gemini" || k === "openrouter";

function isLocal(p: AiProviderConfig): boolean {
  const url = (p.baseUrl.trim() || DEFAULT_URL[p.kind]).toLowerCase();
  const host = url
    .replace(/^\w+:\/\//, "")
    .split(/[/?]/)[0]!
    .replace(/:\d+$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.startsWith("127.") ||
    host === "[::1]"
  );
}

function ruleFor(rules: Record<string, AiRule>, path: string): AiRule {
  let p = path.replace(/^\/+|\/+$/g, "");
  for (;;) {
    if (rules[p]) return rules[p]!;
    if (!p) return "any";
    p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
  }
}

const ORDER: AiRule[] = ["any", "local", "never"];

const estimate = (req: AiRunRequest, attached: string) =>
  Math.ceil(
    (req.messages
      .flatMap((m) => m.content)
      .reduce((n, p) => n + (p.type === "text" ? [...p.text].length : 0), 0) +
      [...attached].length) /
      4,
  ) +
  req.messages.flatMap((m) => m.content).filter((p) => p.type === "image").length * 1000;

/** Scripted answers for tests and demos; `null` falls back to the echo. */
export type AiResponder = (request: AiRunRequest, providerName: string) => string | null;
let responder: AiResponder | null = null;

export function setAiResponder(next: AiResponder | null) {
  responder = next;
}

export function createMemoryAi(readFile: (path: string) => string | null): AiBackend {
  let settings: AiSettings = {
    providers: [],
    tasks: {},
    fallback: [],
    maxInputTokens: null,
    confirmAboveTokens: 4000,
    effort: "balanced",
    logRequests: true,
  };
  const keys = new Set<string>();
  const log: AiLogEntry[] = [];
  const cancelled = new Set<string>();

  const view = (): AiSettingsView => ({
    settings: structuredClone(settings),
    providers: settings.providers.map((p) => ({
      ...p,
      hasKey: keys.has(p.id),
      requiresKey: requiresKey(p.kind),
      local: isLocal(p),
      defaultBaseUrl: DEFAULT_URL[p.kind],
    })) satisfies AiProviderStatus[],
  });

  const provider = (id: string) =>
    settings.providers.find((p) => p.id === id) ?? fail("NotFound", `not found: provider ${id}`);

  const rules = (): Record<string, AiRule> => {
    try {
      const cfg = JSON.parse(readFile(".axisnotes/config.json") ?? "{}") as {
        ai?: { folders?: Record<string, AiRule> };
      };
      const out: Record<string, AiRule> = {};
      for (const [k, v] of Object.entries(cfg.ai?.folders ?? {}))
        if (ORDER.includes(v)) out[k.replace(/^\/+|\/+$/g, "")] = v;
      return out;
    } catch {
      return {};
    }
  };

  const ruleOf = (req: AiRunRequest): AiRule => {
    const r = rules();
    return [...(req.sources ?? []), ...(req.attach ?? [])]
      .map((p) => ruleFor(r, p))
      .reduce<AiRule>((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), "any");
  };

  const candidates = (req: AiRunRequest, rule: AiRule) => {
    if (rule === "never")
      fail(
        "Blocked",
        'This request includes notes from a folder marked "AI: never"; it was not sent.',
      );
    const task = req.task ?? "chat";
    const chain: { p: AiProviderConfig; model?: string }[] = [];
    const push = (p: AiProviderConfig | undefined, model?: string) => {
      if (p && p.enabled && !chain.some((c) => c.p.id === p.id)) chain.push({ p, model });
    };
    if (req.provider) push(provider(req.provider), req.model);
    else if (settings.tasks[task])
      push(
        settings.providers.find((p) => p.id === settings.tasks[task]!.provider),
        settings.tasks[task]!.model,
      );
    for (const id of settings.fallback) push(settings.providers.find((p) => p.id === id));
    if (chain.length === 0) settings.providers.forEach((p) => push(p));
    if (chain.length === 0) fail("Ai", "No AI provider is set up. Add one in Settings → AI.");
    const out = chain
      .filter((c) => rule !== "local" || isLocal(c.p))
      .filter((c) => !requiresKey(c.p.kind) || keys.has(c.p.id))
      .map((c) => ({
        p: c.p,
        model: c.model || DEFAULTS[c.p.kind]?.[task] || modelsFor(c.p.kind)[0]!.id,
      }));
    if (out.length === 0)
      fail(
        rule === "local" ? "Blocked" : "Ai",
        rule === "local"
          ? 'These notes are marked "AI: local models only", and no local provider is available.'
          : "No provider can take this request.",
      );
    return out;
  };

  const attachedText = (req: AiRunRequest) =>
    (req.attach ?? []).map((p) => readFile(p) ?? fail("NotFound", `not found: ${p}`)).join("\n");

  return {
    async aiSettings() {
      return view();
    },
    async aiSaveSettings(next) {
      const ids = new Set<string>();
      for (const p of next.providers) {
        if (!p.id.trim() || ids.has(p.id)) fail("InvalidName", `invalid name: provider id ${p.id}`);
        ids.add(p.id);
      }
      for (const p of settings.providers) if (!ids.has(p.id)) keys.delete(p.id);
      settings = structuredClone({
        ...next,
        fallback: next.fallback.filter((id) => ids.has(id)),
        tasks: Object.fromEntries(
          Object.entries(next.tasks).filter(([, c]) => c && ids.has(c.provider)),
        ),
      });
      return view();
    },
    async aiSetKey(id, key) {
      provider(id);
      if (key.trim()) keys.add(id);
      else keys.delete(id);
    },
    async aiDeleteKey(id) {
      keys.delete(id);
    },
    async aiTestProvider(id) {
      const p = provider(id);
      if (requiresKey(p.kind) && !keys.has(id)) fail("Ai", `${p.name} has no API key`);
      if (p.kind === "custom" && !p.baseUrl.trim()) fail("Ai", `${p.name} has no endpoint URL`);
      return modelsFor(p.kind).length;
    },
    async aiListModels(id) {
      return { models: modelsFor(provider(id).kind), error: null };
    },
    async aiPlan(req) {
      const rule = ruleOf(req);
      const first = candidates(req, rule)[0]!;
      const tokens = estimate(req, attachedText(req));
      return {
        providerId: first.p.id,
        providerName: first.p.name,
        model: first.model,
        local: isLocal(first.p),
        estimatedInputTokens: tokens,
        needsConfirm: tokens > settings.confirmAboveTokens,
        estimatedCost: first.model === "gpt-6-sol" ? (tokens * 2) / 1e6 : null,
        rule,
      };
    },
    async aiRun(runId, req, onDelta): Promise<AiRunResult> {
      const task = req.task ?? "chat";
      const rule = ruleOf(req);
      const tokens = estimate(req, attachedText(req));
      const entry = (status: AiLogEntry["status"], p?: { id: string }, model = ""): AiLogEntry => ({
        time: Date.now(),
        task,
        provider: p?.id ?? "",
        model,
        local: false,
        status,
        estimatedInputTokens: tokens,
        durationMs: 1,
        sources: (req.sources?.length ?? 0) + (req.attach?.length ?? 0),
      });
      if (settings.maxInputTokens !== null && tokens > settings.maxInputTokens) {
        log.unshift(entry("blocked"));
        fail(
          "Blocked",
          `This request is about ${tokens} input tokens, over your limit of ${settings.maxInputTokens}.`,
        );
      }
      let chosen;
      try {
        chosen = candidates(req, rule)[0]!;
      } catch (e) {
        if ((e as BackendError).code === "Blocked") log.unshift(entry("blocked"));
        throw e;
      }
      const last = [...req.messages].reverse().find((m) => m.role === "user");
      const prompt =
        last?.content.map((p) => (p.type === "text" ? p.text : "[image]")).join(" ") ?? "";
      const answer =
        responder?.(req, chosen.p.name) ?? `Echo from ${chosen.p.name}: ${prompt.slice(0, 200)}`;
      let text = "";
      for (const word of answer.split(/(?<= )/)) {
        await new Promise((r) => setTimeout(r, 0));
        if (cancelled.delete(runId)) {
          log.unshift(entry("cancelled", chosen.p, chosen.model));
          fail("Cancelled", "cancelled");
        }
        text += word;
        onDelta(word);
      }
      if (settings.logRequests)
        log.unshift({
          ...entry("ok", chosen.p, chosen.model),
          local: isLocal(chosen.p),
          inputTokens: tokens,
          outputTokens: Math.ceil(text.length / 4),
        });
      return {
        text,
        providerId: chosen.p.id,
        providerName: chosen.p.name,
        model: chosen.model,
        local: isLocal(chosen.p),
        usage: { inputTokens: tokens, outputTokens: Math.ceil(text.length / 4) },
        fallbackFrom: null,
      };
    },
    async aiCancel(runId) {
      cancelled.add(runId);
    },
    async aiLog(limit = 200) {
      return log.slice(0, limit);
    },
  };
}
