import { buildUserPrompt, createSpecStreamCompiler } from "@json-render/core";
import type { Spec } from "@json-render/react";
import { matchMockSpec } from "./mocks";
import { systemPrompt } from "./registry";
import { WebLlmError, type WebLlmEngine } from "./webllm";

export interface GenerationConfig {
  /** "webllm" generates with the loaded engine; "preset" renders a built-in sample. */
  source: "preset" | "webllm";
  /** When false, request the whole response at once instead of streaming it. */
  stream: boolean;
  /** The loaded WebLLM engine, or null when no model is ready. */
  engine: WebLlmEngine | null;
}

export interface StreamResult {
  spec: Spec;
  mode: "live" | "mock";
  /** Human-readable explanation shown when `mode` is "mock". */
  reason?: string;
  /** JSONL patch lines applied to build the spec. */
  lines: string[];
}

export interface LlmPrompts {
  /** The exact system instruction sent to the model. */
  systemPrompt: string;
  /** The exact user prompt sent to the model. In Edit Mode this embeds the
   *  current spec, so it reflects precisely what the model received. */
  userPrompt: string;
}

export interface StreamHandlers {
  /** Called with the progressively-built spec after each batch of patches. */
  onSpec: (spec: Spec) => void;
  /** Called with newly-applied JSONL patch lines. */
  onLines: (lines: string[]) => void;
  /** Called once with the exact prompts captured immediately before the model
   *  request, or `null` for Preset requests where no LLM prompt is sent. The
   *  capture fires before `chat.completions.create`, so it is retained even
   *  when generation later fails. */
  onPrompts: (prompts: LlmPrompts | null) => void;
}

/** RFC 6902 ops the Astryx spec pipeline actually applies. The compiler counts
 *  every parsed line in getPatches() — including move/copy/test and unknown ops
 *  it never mutates the spec with — so any other op is rejected below. */
const SUPPORTED_PATCH_OPS = new Set(["add", "remove", "replace"]);

/** Cap the raw model output retained for diagnostics *during* accumulation so a
 *  long response never grows the buffer unbounded, while keeping more than the
 *  snippet we surface (below) as headroom. */
const MAX_DIAGNOSTIC_RAW_LENGTH = 1000;

/** How many characters of the accumulated raw output to echo in an error. */
const RAW_SNIPPET_LENGTH = 500;

/**
 * Describe the raw model response as bounded, single-line evidence for an
 * inference error. Only the model's own response content is passed here — never
 * the system/user prompt — and it is truncated and control-char escaped so a
 * real failure (prose, markdown fences, garbage) is diagnosable without leaking
 * an unbounded or unreadable blob.
 */
function describeRawOutput(raw: string): string {
  if (raw.length === 0) return "Model output: (empty)";
  const escaped = raw
    .slice(0, RAW_SNIPPET_LENGTH)
    .replace(/[\u0000-\u001f]/g, (char) => {
      if (char === "\n") return "\\n";
      if (char === "\t") return "\\t";
      if (char === "\r") return "\\r";
      return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
    });
  return `Model output: ${escaped}`;
}


/** Deep-clone a JSON-compatible Spec so the compiler seed and progressive
 *  callback snapshots never share mutable nested state with the live compiler
 *  result (a later patch must not retroactively change an earlier snapshot). */
function cloneSpec(spec: Spec): Spec {
  return JSON.parse(JSON.stringify(spec)) as Spec;
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

/**
 * Stream a spec by calling the loaded WebLLM engine (OpenAI-compatible API):
 * the model emits JSONL patch operations, which `createSpecStreamCompiler`
 * assembles into a spec that grows as the stream arrives (progressive
 * rendering). Unlike Preset mode, WebLLM failures reject with a `WebLlmError`
 * so the caller can preserve the current spec instead of silently rendering a
 * mock.
 */
export async function streamSpec(
  prompt: string,
  config: GenerationConfig,
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
    // No LLM request is made, so there is no prompt to surface in the Code pane.
    handlers.onPrompts(null);
    return {
      spec: mock,
      mode: "mock",
      lines: [],
      reason:
        "Preset mode — rendered a built-in sample. Switch to WebLLM in Settings to generate live.",
    };
  }

  const compiler = createSpecStreamCompiler<Spec>(
    baseSpec ? cloneSpec(baseSpec) : undefined,
  );
  const lines: string[] = [];
  // Accumulate the raw model response (bounded) so a zero-patch or nonmountable
  // failure can quote the actual output as diagnostic evidence.
  let rawOutput = "";
  // One code path for both modes: feed each content chunk (streaming) or the
  // whole response (non-streaming) through the same compiler.
  const applyChunk = (chunk: string) => {
    if (!chunk) return;
    if (rawOutput.length < MAX_DIAGNOSTIC_RAW_LENGTH) {
      rawOutput = (rawOutput + chunk).slice(0, MAX_DIAGNOSTIC_RAW_LENGTH);
    }
    const { result, newPatches } = compiler.push(chunk);
    if (newPatches.length === 0) return;
    const newLines = newPatches.map((patch) => JSON.stringify(patch));
    lines.push(...newLines);
    handlers.onLines(newLines);
    const partial = withResolvedRoot(result as Spec);
    if (isMountable(partial)) {
      handlers.onSpec(cloneSpec(partial));
    }
  };

  if (!config.engine) {
    throw new WebLlmError(
      "inference-failed",
      "The selected WebLLM model is not ready. Load it in Settings and retry.",
    );
  }

  // Edit mode: when a spec already exists, buildUserPrompt embeds it and asks
  // the model to emit only the patches that change it.
  const userPrompt = buildUserPrompt({
    prompt,
    currentSpec: baseSpec,
    editModes: ["patch"],
  });
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  // Capture the exact prompts immediately before the model request so the Code
  // pane can show precisely what was sent — and keep them even if the request
  // below fails.
  handlers.onPrompts({ systemPrompt, userPrompt });

  try {
    if (config.stream) {
      const response = await config.engine.chat.completions.create({
        messages,
        temperature: 0,
        stream: true,
      });
      for await (const chunk of response) {
        applyChunk(chunk.choices[0]?.delta.content ?? "");
      }
    } else {
      const response = await config.engine.chat.completions.create({
        messages,
        temperature: 0,
        stream: false,
      });
      applyChunk(response.choices[0]?.message.content ?? "");
    }

    const finalResult = compiler.getResult();
    // `getResult()` flushes the trailing buffered line — a patch that arrived
    // without a closing newline — into the compiler's applied set, but that
    // patch is never surfaced through `push()`'s `newPatches`. For a one-line
    // follow-up edit ("change the label"), that flushed patch is the ONLY one,
    // so the stream view would otherwise stay empty even though the Preview
    // updated. Reconcile against the authoritative patch list and emit the tail.
    const patches = compiler.getPatches();
    const allLines = patches.map((patch) => JSON.stringify(patch));
    if (allLines.length > lines.length) {
      const missing = allLines.slice(lines.length);
      lines.push(...missing);
      handlers.onLines(missing);
    }
    // Reject zero-patch output before accepting a seeded mountable spec: an
    // empty response leaves the cloned baseSpec intact, which would otherwise
    // masquerade as a successful live generation.
    if (allLines.length === 0) {
      throw new Error(
        `The model response did not contain any valid JSONL patches. ${describeRawOutput(rawOutput)}`,
      );
    }
    // The compiler counts an unsupported op (move/copy/test or an unknown op)
    // in getPatches() while applying no change, so on a seeded edit the intact
    // clone would masquerade as a live success. Reject any op we don't apply.
    const unsupported = patches.find(
      (patch) => !SUPPORTED_PATCH_OPS.has(patch.op),
    );
    if (unsupported) {
      throw new Error(
        `The model emitted an unsupported patch operation: ${unsupported.op}.`,
      );
    }
    const spec = withResolvedRoot(finalResult);
    if (!isSpec(spec) || !isMountable(spec)) {
      throw new Error(
        `The model response did not produce a mountable UI spec. ${describeRawOutput(rawOutput)}`,
      );
    }
    return { spec, mode: "live", lines };
  } catch (error) {
    if (error instanceof WebLlmError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new WebLlmError(
      "inference-failed",
      `WebLLM generation failed: ${message}`,
      { cause: error },
    );
  }
}
