import { Ollama } from "ollama/browser";
import type { Spec } from "@json-render/react";
import { matchMockSpec } from "./mocks";
import { systemPrompt, jsonSchema } from "./registry";

export interface OllamaConfig {
  model: string;
  port: string;
}

export interface GenerateResult {
  spec: Spec;
  mode: "live" | "mock";
  /** Human-readable explanation shown when `mode` is "mock". */
  reason?: string;
}

/** A prior conversation turn passed back to the model for context. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

function isSpec(value: unknown): value is Spec {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { root?: unknown }).root === "string" &&
    typeof (value as { elements?: unknown }).elements === "object"
  );
}

/**
 * A spec renders nothing if its root is missing or any element references a
 * child key that was never defined. Catch that so we fall back to a mock
 * instead of silently showing an empty Preview.
 */
function isRenderable(spec: Spec): boolean {
  const elements = spec.elements as Record<
    string,
    { children?: string[] } | undefined
  >;
  if (!elements[spec.root]) return false;
  for (const element of Object.values(elements)) {
    for (const childKey of element?.children ?? []) {
      if (!elements[childKey]) return false;
    }
  }
  return true;
}

/** Turns an Ollama failure into an actionable, accurate message. */
async function describeFailure(
  error: unknown,
  config: OllamaConfig,
): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /failed to fetch|fetch failed|networkerror|load failed|connection refused/i.test(
      message,
    )
  ) {
    return `Couldn’t reach Ollama at localhost:${config.port} — is it running? (Browser calls may need OLLAMA_ORIGINS.) Showing a mock instead.`;
  }
  if (/not found/i.test(message)) {
    const base = config.model.split(":")[0];
    const { models } = await checkOllama(config.port);
    const variants = models.filter((name) => name.split(":")[0] === base);
    if (variants.length > 0) {
      return `Model “${config.model}” isn’t installed, but you have ${variants.join(", ")} — put one of those in the Model field. Showing a mock for now.`;
    }
    return `Model “${config.model}” isn’t installed — run \`ollama pull ${config.model}\`. Showing a mock instead.`;
  }
  return `Ollama error: ${message}. Showing a mock instead.`;
}

/**
 * Generate a spec by calling the user's local Ollama server DIRECTLY FROM THE
 * BROWSER via ollama-js (structured output constrained by `specJsonSchema`).
 * Requires Ollama running locally with the chosen model. Any failure — Ollama
 * not running, a CORS block, or unparseable output — falls back to a
 * deterministic mock spec so the playground always renders something.
 */
export async function generateSpec(
  prompt: string,
  config: OllamaConfig,
  history: ChatTurn[] = [],
): Promise<GenerateResult> {
  try {
    const ollama = new Ollama({ host: `http://localhost:${config.port}` });
    const response = await ollama.chat({
      model: config.model,
      stream: false,
      format: jsonSchema,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: prompt },
      ],
    });
    const parsed: unknown = JSON.parse(response.message.content);
    if (isSpec(parsed) && isRenderable(parsed)) {
      return { spec: parsed, mode: "live" };
    }
    return {
      spec: matchMockSpec(prompt),
      mode: "mock",
      reason: isSpec(parsed)
        ? "The model returned an incomplete spec (it referenced elements it never defined) — showing a mock instead."
        : "Ollama replied, but not with a valid UI spec — showing a mock instead.",
    };
  } catch (error) {
    console.error("Ollama generation failed; falling back to mock.", error);
    return {
      spec: matchMockSpec(prompt),
      mode: "mock",
      reason: await describeFailure(error, config),
    };
  }
}

export interface OllamaStatus {
  reachable: boolean;
  models: string[];
  /** Subset of `models` that support chat completion (structured-output capable). */
  chatModels: string[];
}

/**
 * Lightweight reachability probe for the local Ollama server. Lists installed
 * models, then inspects each model's capabilities (`ollama.show`) to surface the
 * ones that can do chat completion — used for the model dropdown and the
 * "online / model not installed / offline" indicator.
 */
export async function checkOllama(port: string): Promise<OllamaStatus> {
  try {
    const ollama = new Ollama({ host: `http://localhost:${port}` });
    const { models } = await ollama.list();
    const names = models.map((entry) => entry.name);
    const capable = await Promise.all(
      names.map(async (name) => {
        try {
          const info = await ollama.show({ model: name });
          return (info.capabilities ?? []).includes("completion") ? name : null;
        } catch {
          return null;
        }
      }),
    );
    return {
      reachable: true,
      models: names,
      chatModels: capable.filter((name): name is string => name !== null),
    };
  } catch {
    return { reachable: false, models: [], chatModels: [] };
  }
}

/** True when `model` (with or without a tag) matches an installed model. */
export function isModelInstalled(models: string[], model: string): boolean {
  const target = model.trim();
  if (!target) return false;
  if (models.includes(target)) return true;
  if (!target.includes(":")) {
    // Tag-less names resolve to `:latest` in Ollama's chat API.
    return models.includes(`${target}:latest`);
  }
  return false;
}
