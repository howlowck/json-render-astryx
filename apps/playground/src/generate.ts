import { Ollama } from "ollama/browser";
import { buildUserPrompt, createSpecStreamCompiler } from "@json-render/core";
import type { Spec } from "@json-render/react";
import { matchMockSpec } from "./mocks";
import { systemPrompt } from "./registry";

export interface OllamaConfig {
  model: string;
  port: string;
  /** "ollama" streams from the local server; "preset" renders a built-in sample. */
  source: "preset" | "ollama";
  /** When false, request the whole response at once instead of streaming it. */
  stream: boolean;
}

export interface StreamResult {
  spec: Spec;
  mode: "live" | "mock";
  /** Human-readable explanation shown when `mode` is "mock". */
  reason?: string;
  /** JSONL patch lines applied to build the spec. */
  lines: string[];
}

export interface StreamHandlers {
  /** Called with the progressively-built spec after each batch of patches. */
  onSpec: (spec: Spec) => void;
  /** Called with newly-applied JSONL patch lines. */
  onLines: (lines: string[]) => void;
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
 * During streaming, patches arrive in order — `/root` lands before the matching
 * `/elements/<root>` patch. The Renderer crashes on a spec whose root element is
 * not yet present, so only hand it a spec once the root element exists. Missing
 * *children* are fine — the Renderer skips them (with a console warning), so a
 * spec that references a child it never defined still renders everything else.
 */
function isMountable(spec: Spec): boolean {
  const root = (spec as { root?: unknown }).root;
  const elements = (spec as { elements?: Record<string, unknown> }).elements;
  return (
    typeof root === "string" &&
    !!elements &&
    typeof elements === "object" &&
    !!elements[root]
  );
}

/**
 * Models sometimes set `/root` to a key they never define (e.g. root "main"
 * while the actual top element is "pricing-card"). Repair it by pointing root at
 * the one element that no other element lists as a child.
 */
function withResolvedRoot(spec: Spec): Spec {
  const root = (spec as { root?: unknown }).root;
  const elements = (spec as { elements?: Record<string, { children?: string[] }> })
    .elements;
  if (!elements || typeof elements !== "object") return spec;
  if (typeof root === "string" && elements[root]) return spec;
  const childKeys = new Set<string>();
  for (const element of Object.values(elements)) {
    for (const child of element?.children ?? []) childKeys.add(child);
  }
  const candidate = Object.keys(elements).find((key) => !childKeys.has(key));
  return candidate ? ({ ...spec, root: candidate } as Spec) : spec;
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
 * Stream a spec by calling the user's local Ollama server DIRECTLY FROM THE
 * BROWSER via ollama-js in standalone mode: the model emits JSONL patch
 * operations, which `createSpecStreamCompiler` assembles into a spec that grows
 * as the stream arrives (progressive rendering). Any failure — Ollama not
 * running, a CORS block, or unparseable output — falls back to a deterministic
 * mock spec so the playground always renders something.
 */
export async function streamSpec(
  prompt: string,
  config: OllamaConfig,
  baseSpec: Spec | null,
  handlers: StreamHandlers,
): Promise<StreamResult> {
  // Seed the compiler with the current spec so a follow-up ("make the button
  // green") applies its patches on top of the existing UI instead of starting
  // from an empty document. Clone it so we never mutate React state.
  // Preset mode never touches the network — it just renders a matching sample
  // spec so the playground works with no local model installed.
  if (config.source === "preset") {
    const mock = matchMockSpec(prompt);
    handlers.onSpec(mock);
    return {
      spec: mock,
      mode: "mock",
      lines: [],
      reason:
        "Preset mode — rendered a built-in sample. Switch to Ollama in Settings to generate live.",
    };
  }

  const compiler = createSpecStreamCompiler<Spec>(
    baseSpec ? (JSON.parse(JSON.stringify(baseSpec)) as Spec) : undefined,
  );
  const lines: string[] = [];
  try {
    const ollama = new Ollama({ host: `http://localhost:${config.port}` });
    // Edit mode: when a spec already exists, buildUserPrompt embeds it and asks
    // the model to emit only the patches that change it.
    const userPrompt = buildUserPrompt({
      prompt,
      currentSpec: baseSpec,
      editModes: ["patch"],
    });
    // One code path for both modes: feed each content chunk (streaming) or the
    // whole response (non-streaming) through the same compiler.
    const applyChunk = (chunk: string) => {
      if (!chunk) return;
      const { result, newPatches } = compiler.push(chunk);
      if (newPatches.length === 0) return;
      const newLines = newPatches.map((patch) => JSON.stringify(patch));
      lines.push(...newLines);
      handlers.onLines(newLines);
      const partial = withResolvedRoot(result as Spec);
      if (isMountable(partial)) {
        handlers.onSpec({ ...partial });
      }
    };
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
    if (config.stream) {
      const stream = await ollama.chat({
        model: config.model,
        stream: true,
        options: { temperature: 0 },
        messages,
      });
      for await (const part of stream) {
        applyChunk(part.message?.content ?? "");
      }
    } else {
      const response = await ollama.chat({
        model: config.model,
        stream: false,
        options: { temperature: 0 },
        messages,
      });
      applyChunk(response.message?.content ?? "");
    }
    const finalResult = compiler.getResult();
    // `getResult()` flushes the trailing buffered line — a patch that arrived
    // without a closing newline — into the compiler's applied set, but that
    // patch is never surfaced through `push()`'s `newPatches`. For a one-line
    // follow-up edit ("change the label"), that flushed patch is the ONLY one,
    // so the stream view would otherwise stay empty even though the Preview
    // updated. Reconcile against the authoritative patch list and emit the tail.
    const allLines = compiler.getPatches().map((patch) => JSON.stringify(patch));
    if (allLines.length > lines.length) {
      const missing = allLines.slice(lines.length);
      lines.push(...missing);
      handlers.onLines(missing);
    }
    const spec = withResolvedRoot(finalResult);
    if (isSpec(spec) && isMountable(spec)) {
      return { spec, mode: "live", lines };
    }
    const mock = matchMockSpec(prompt);
    handlers.onSpec(mock);
    return {
      spec: mock,
      mode: "mock",
      lines,
      reason:
        "Ollama replied, but not with a renderable UI spec — showing a mock instead.",
    };
  } catch (error) {
    console.error("Ollama streaming failed; falling back to mock.", error);
    const mock = matchMockSpec(prompt);
    handlers.onSpec(mock);
    return {
      spec: mock,
      mode: "mock",
      lines,
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
