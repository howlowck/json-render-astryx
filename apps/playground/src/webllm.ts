import {
  CreateWebWorkerMLCEngine,
  ModelType,
  hasModelInCache,
  prebuiltAppConfig,
  type AppConfig,
  type ChatOptions,
  type InitProgressReport,
  type MLCEngineInterface,
  type ModelRecord,
} from "@mlc-ai/web-llm";

// Every curated engine loads with an explicit 8192-token context window: the
// prebuilt model records default to context_window_size 4096, but catalog
// patch-mode prompts can exceed that and were failing at runtime with
// ContextWindowSizeExceededError (e.g. 4349 prompt tokens > 4096 window).
export const WEBLLM_CONTEXT_WINDOW_SIZE = 8192;

export const WEBLLM_CHAT_OPTIONS: ChatOptions = Object.freeze({
  context_window_size: WEBLLM_CONTEXT_WINDOW_SIZE,
});

export const WEBLLM_MODELS = [
  {
    id: "Qwen3-4B-q4f16_1-MLC",
    label: "Qwen3 4B",
    memory: "Largest browser GPU footprint",
    note: "Default; strongest JSON-patch reliability, with a large download and GPU requirement.",
  },
  {
    id: "Phi-4-mini-instruct-q4f16_1-MLC",
    label: "Phi-4 Mini Instruct",
    memory: "Largest browser GPU footprint",
    note: "Strong instruction following with a large download and GPU requirement.",
  },
  {
    id: "Qwen3.5-2B-q4f16_1-MLC",
    label: "Qwen3.5 2B",
    memory: "Large browser GPU footprint",
    note: "Strong quality with a smaller footprint than the default Qwen3 4B.",
  },
  {
    id: "Qwen3.5-0.8B-q4f16_1-MLC",
    label: "Qwen3.5 0.8B",
    memory: "Moderate browser GPU footprint",
    note: "Faster and lighter, with lower JSON-patch reliability than larger Qwen models.",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B Instruct",
    memory: "Moderate browser GPU footprint",
    note: "Balanced quality and footprint.",
  },
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 0.5B Instruct",
    memory: "Moderate browser GPU footprint",
    note: "Faster small model with lower generation quality.",
  },
  {
    id: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    label: "SmolLM2 360M Instruct",
    memory: "Smallest browser GPU footprint",
    note: "Smallest download; weakest JSON-patch reliability.",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B Instruct",
    memory: "Large browser GPU footprint",
    note: "Better quality; unavailable on many devices.",
  },
] as const;

export type WebLlmModelId = (typeof WEBLLM_MODELS)[number]["id"];
export const DEFAULT_WEBLLM_MODEL_ID: WebLlmModelId = WEBLLM_MODELS[0].id;

/**
 * Any model id the runtime may be asked to load. The curated list drives the
 * default and the picker labels, but a user can also supply the exact id of any
 * model already present in the installed WebLLM prebuilt catalog. Only prebuilt
 * ids are loadable — arbitrary remote weights or WebAssembly are out of scope.
 */
export type WebLlmLoadableModelId = string;

/** Resolve the installed prebuilt record for an exact model id, or undefined. */
export function findWebLlmModelRecord(
  modelId: WebLlmLoadableModelId,
): ModelRecord | undefined {
  if (!modelId) return undefined;
  return prebuiltAppConfig.model_list.find(
    (record) => record.model_id === modelId,
  );
}

/**
 * Prebuilt q4f16 text-generation records with declared context windows above
 * 4000 tokens, in WebLLM's catalog order. A record with no `model_type` defaults
 * to LLM per WebLLM's convention. This reads the config without mutating it.
 */
export const WEBLLM_PREBUILT_MODELS: readonly ModelRecord[] =
  prebuiltAppConfig.model_list.filter(
    (record) =>
      (record.model_type === undefined || record.model_type === ModelType.LLM) &&
      record.model_id.includes("q4f16") &&
      (record.overrides?.context_window_size ?? 0) > 4000,
  );

/**
 * True when the exact prebuilt model id already has its weights in the browser's
 * WebLLM cache. Delegates to WebLLM's official `hasModelInCache`, which only
 * inspects existing cache entries and never downloads. The check seam is
 * injectable so component/unit tests never touch the real Cache/IndexedDB API.
 */
export function isWebLlmModelCached(
  modelId: WebLlmLoadableModelId,
  check: (
    modelId: string,
    appConfig?: AppConfig,
  ) => Promise<boolean> = hasModelInCache,
): Promise<boolean> {
  return check(modelId, prebuiltAppConfig);
}

/** True when the exact model id exists in the installed prebuilt catalog. */
export function isWebLlmModelAvailable(
  modelId: WebLlmLoadableModelId,
): boolean {
  return findWebLlmModelRecord(modelId) !== undefined;
}

export interface WebLlmModelInfo {
  id: WebLlmLoadableModelId;
  label: string;
  memory: string;
  note: string;
}

/**
 * Display metadata for the currently selected model. A curated model carries its
 * authored label/footprint/note; any other installed prebuilt record shows the
 * exact id as the label with generic catalog-backed guidance.
 */
export function webLlmModelInfo(
  modelId: WebLlmLoadableModelId,
): WebLlmModelInfo {
  const curated = WEBLLM_MODELS.find(({ id }) => id === modelId);
  if (curated) return curated;
  return {
    id: modelId,
    label: modelId,
    memory: "WebLLM prebuilt model",
    note: "Installed in the WebLLM prebuilt catalog.",
  };
}

export type WebLlmErrorCode =
  | "webgpu-unavailable"
  | "feature-unavailable"
  | "model-unavailable"
  | "model-load-failed"
  | "storage-failed"
  | "worker-failed"
  | "termination-failed"
  | "load-cancelled"
  | "inference-failed";

export class WebLlmError extends Error {
  constructor(
    public readonly code: WebLlmErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WebLlmError";
  }
}

export interface GpuLike {
  requestAdapter(): Promise<{ features: ReadonlySet<string> } | null>;
}

export function getBrowserGpu(): GpuLike | undefined {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return undefined;
  return (navigator as Navigator & { gpu: GpuLike }).gpu;
}

function requiredFeaturesForModel(
  modelId: WebLlmLoadableModelId,
): readonly string[] {
  const record = findWebLlmModelRecord(modelId);
  if (!record) {
    throw new WebLlmError(
      "model-unavailable",
      `The ${modelId} model is not present in the installed WebLLM model catalog. Choose a different model or Preset.`,
    );
  }
  return record.required_features ?? [];
}

export async function assertWebGpuSupport(
  gpu: GpuLike | undefined,
  modelId: WebLlmLoadableModelId = DEFAULT_WEBLLM_MODEL_ID,
): Promise<void> {
  if (!gpu) {
    throw new WebLlmError(
      "webgpu-unavailable",
      "WebGPU is unavailable in this browser. Use a WebGPU-capable browser or choose Preset.",
    );
  }
  let adapter: Awaited<ReturnType<GpuLike["requestAdapter"]>>;
  try {
    adapter = await gpu.requestAdapter();
  } catch (cause) {
    throw new WebLlmError(
      "webgpu-unavailable",
      "Requesting a WebGPU adapter failed. Check browser and hardware acceleration settings or choose Preset.",
      { cause },
    );
  }
  if (!adapter) {
    throw new WebLlmError(
      "webgpu-unavailable",
      "No usable WebGPU adapter is available. Check browser and hardware acceleration settings or choose Preset.",
    );
  }
  const missing = requiredFeaturesForModel(modelId).filter(
    (feature) => !adapter.features.has(feature),
  );
  if (missing.length > 0) {
    throw new WebLlmError(
      "feature-unavailable",
      `The ${modelId} model requires the ${missing.join(", ")} WebGPU feature on this device. Choose a different model or Preset.`,
    );
  }
}

export type WebLlmEngine = MLCEngineInterface;
export type WebLlmProgress = InitProgressReport;

export interface WebLlmEngineConfig {
  initProgressCallback: (report: InitProgressReport) => void;
}

export interface WebLlmRuntimeDependencies {
  getGpu: () => GpuLike | undefined;
  createWorker: () => Worker;
  createEngine: (
    worker: Worker,
    modelId: WebLlmLoadableModelId,
    config: WebLlmEngineConfig,
    chatOpts: ChatOptions,
  ) => Promise<WebLlmEngine>;
}

export interface WebLlmRuntime {
  current(): WebLlmEngine | null;
  load(
    modelId: WebLlmLoadableModelId,
    onProgress: (report: InitProgressReport) => void,
  ): Promise<WebLlmEngine>;
  unload(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Default `createEngine` adapter. The 4th `chatOpts` argument is forwarded to
 * `CreateWebWorkerMLCEngine` so the engine reloads with an explicit 8192-token
 * context window instead of the model record's prebuilt 4096 default. The
 * engine factory is injectable purely to keep this seam unit-testable without a
 * real Worker or WebGPU device.
 */
export type WebWorkerEngineFactory = (
  worker: Worker,
  modelId: WebLlmLoadableModelId,
  config: WebLlmEngineConfig,
  chatOpts: ChatOptions,
) => Promise<WebLlmEngine>;

export function createWebWorkerEngine(
  worker: Worker,
  modelId: WebLlmLoadableModelId,
  config: WebLlmEngineConfig,
  chatOpts: ChatOptions,
  create: WebWorkerEngineFactory = CreateWebWorkerMLCEngine,
): Promise<WebLlmEngine> {
  return create(worker, modelId, config, chatOpts);
}

const defaultDependencies: WebLlmRuntimeDependencies = {
  getGpu: getBrowserGpu,
  createWorker: () =>
    new Worker(new URL("./webllm.worker.ts", import.meta.url), {
      type: "module",
    }),
  createEngine: createWebWorkerEngine,
};

function classifyLoadFailure(message: string): WebLlmErrorCode {
  if (/quota|storage|cache|indexeddb/i.test(message)) return "storage-failed";
  if (/worker|terminated|message channel/i.test(message)) return "worker-failed";
  return "model-load-failed";
}

/**
 * Each load attempt owns exactly one worker and, once resolved, one engine.
 * A ready engine is normally unloaded while its worker is still alive, then the
 * worker is terminated. If that worker instead crashes (an `error`/`messageerror`
 * transport event), its unload RPC would route through the dead worker and never
 * settle, so cleanup skips the unload, terminates immediately, and clears the
 * current engine. A crash that lands mid-unload cancels the in-flight unload
 * race the same way, so a concurrent normal unload cannot deadlock. A
 * still-pending attempt is cancelled by terminating its worker immediately; the
 * orphaned `CreateWebWorkerMLCEngine` RPC never settles once the worker is gone,
 * so cleanup neither awaits nor unloads it. This lets cleanup and any concurrent
 * load/unload/dispose settle without leaking a live worker.
 */
export function createWebLlmRuntime(
  dependencies: WebLlmRuntimeDependencies = defaultDependencies,
): WebLlmRuntime {
  interface LoadAttempt {
    revision: number;
    worker: Worker;
    engine: WebLlmEngine | null;
    enginePromise: Promise<WebLlmEngine> | null;
    cancelled: boolean;
    cleaned: boolean;
    cleanupPromise: Promise<void> | null;
    cancelSignal: Promise<never>;
    triggerCancel: (reason?: WebLlmError) => void;
    transportDead: boolean;
    transportSignal: Promise<void>;
    signalTransportDead: () => void;
    removeListeners: () => void;
  }

  let active: LoadAttempt | null = null;
  let revision = 0;
  const attempts = new Set<LoadAttempt>();

  async function cleanupAttempt(
    attempt: LoadAttempt,
    reason?: WebLlmError,
  ): Promise<void> {
    if (attempt.cleanupPromise) return attempt.cleanupPromise;
    attempt.cancelled = true;
    // Release any in-flight load() await so it settles with the triggering
    // structured error (load-cancelled for lifecycle cleanup, worker-failed for
    // a transport error) instead of hanging on the orphaned engine RPC.
    attempt.triggerCancel(reason);
    attempt.cleanupPromise = (async () => {
      let failure: unknown;
      if (attempt.engine) {
        const readyEngine = attempt.engine;
        if (attempt.transportDead) {
          // The worker already crashed: its unload RPC routes through a dead
          // worker and would never settle. Skip unload; just tear down.
          attempt.removeListeners();
          try {
            attempt.worker.terminate();
          } catch (error) {
            failure = error;
          }
        } else {
          // Live worker: unload through it first, but keep transport listeners
          // active and race the unload against a mid-flight worker crash so a
          // suddenly-dead worker cancels the otherwise never-settling RPC
          // instead of hanging cleanup (and any concurrent unload) forever.
          let unloadError: unknown;
          let unloadRejected = false;
          const unloadSettled = readyEngine.unload().then(
            () => undefined,
            (error) => {
              unloadRejected = true;
              unloadError = error;
            },
          );
          await Promise.race([unloadSettled, attempt.transportSignal]);
          // A live worker's genuine unload failure still surfaces as
          // termination-failed; a transport crash does not (the worker is gone).
          if (!attempt.transportDead && unloadRejected) failure = unloadError;
          attempt.removeListeners();
          try {
            attempt.worker.terminate();
          } catch (error) {
            failure ??= error;
          }
        }
      } else {
        // Still-pending attempt: terminating the worker leaves the engine RPC
        // unsettled forever. Do not await or unload it; just guard the orphan
        // promise from becoming an unhandled rejection.
        attempt.enginePromise?.then(undefined, () => undefined);
        attempt.removeListeners();
        try {
          attempt.worker.terminate();
        } catch (error) {
          failure = error;
        }
      }
      attempt.cleaned = true;
      attempts.delete(attempt);
      if (active === attempt) active = null;
      if (failure) {
        throw new WebLlmError(
          "termination-failed",
          "The previous WebLLM worker could not be shut down. Reload the page or choose Preset.",
          { cause: failure },
        );
      }
    })();
    return attempt.cleanupPromise;
  }

  async function cleanupAll(): Promise<void> {
    const pending = [...attempts];
    const results = await Promise.allSettled(
      pending.map((attempt) => cleanupAttempt(attempt)),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  }

  return {
    current: () => active?.engine ?? null,
    async load(modelId, onProgress) {
      const requestRevision = ++revision;
      await cleanupAll();
      await assertWebGpuSupport(dependencies.getGpu(), modelId);
      if (requestRevision !== revision) {
        throw new WebLlmError("load-cancelled", "Model loading was cancelled.");
      }

      let nextWorker: Worker;
      try {
        nextWorker = dependencies.createWorker();
      } catch (cause) {
        throw new WebLlmError(
          "worker-failed",
          "The WebLLM worker could not be created. Retry or choose Preset.",
          { cause },
        );
      }
      let triggerCancel!: (reason?: WebLlmError) => void;
      const cancelSignal = new Promise<never>((_, reject) => {
        triggerCancel = (reason) =>
          reject(
            reason ??
              new WebLlmError("load-cancelled", "Model loading was cancelled."),
          );
      });
      // Keep an unraced cancel signal (a ready attempt never races it) from
      // surfacing as an unhandled rejection.
      cancelSignal.catch(() => undefined);
      // A worker transport crash resolves this signal so an in-flight ready
      // unload race can settle without waiting on the dead worker's RPC.
      let resolveTransport!: () => void;
      const transportSignal = new Promise<void>((resolve) => {
        resolveTransport = resolve;
      });
      const attempt: LoadAttempt = {
        revision: requestRevision,
        worker: nextWorker,
        engine: null,
        enginePromise: null,
        cancelled: false,
        cleaned: false,
        cleanupPromise: null,
        cancelSignal,
        triggerCancel,
        transportDead: false,
        transportSignal,
        signalTransportDead: () => undefined,
        removeListeners: () => undefined,
      };
      // Record a worker crash synchronously (so cleanup can skip the dead-worker
      // unload) and release any in-flight unload race.
      attempt.signalTransportDead = () => {
        attempt.transportDead = true;
        resolveTransport();
      };
      // The WebLLM client only listens for `message`, so a worker transport
      // failure would otherwise leave the create RPC pending forever. Bridge the
      // `error`/`messageerror` events into structured cancellation so a pending
      // load rejects with worker-failed and the worker is torn down.
      const handleWorkerError = (event: Event) => {
        const detail =
          event instanceof ErrorEvent && event.message
            ? event.message
            : "The WebLLM worker reported a fatal error";
        attempt.signalTransportDead();
        void cleanupAttempt(
          attempt,
          new WebLlmError(
            "worker-failed",
            `${detail}. Retry or choose Preset.`,
            { cause: event },
          ),
        ).catch(() => undefined);
      };
      const handleMessageError = (event: Event) => {
        attempt.signalTransportDead();
        void cleanupAttempt(
          attempt,
          new WebLlmError(
            "worker-failed",
            "The WebLLM worker sent a message that could not be deserialized. Retry or choose Preset.",
            { cause: event },
          ),
        ).catch(() => undefined);
      };
      nextWorker.addEventListener("error", handleWorkerError);
      nextWorker.addEventListener("messageerror", handleMessageError);
      attempt.removeListeners = () => {
        nextWorker.removeEventListener("error", handleWorkerError);
        nextWorker.removeEventListener("messageerror", handleMessageError);
      };
      attempts.add(attempt);
      active = attempt;
      attempt.enginePromise = Promise.resolve().then(() =>
        dependencies.createEngine(
          nextWorker,
          modelId,
          {
            initProgressCallback: (report) => {
              if (!attempt.cancelled && requestRevision === revision) {
                onProgress(report);
              }
            },
          },
          WEBLLM_CHAT_OPTIONS,
        ),
      );
      try {
        // Race the engine RPC against cancellation so a terminated worker's
        // never-settling RPC cannot pin this load open forever.
        const nextEngine = await Promise.race([
          attempt.enginePromise,
          attempt.cancelSignal,
        ]);
        attempt.engine = nextEngine;
        if (attempt.cancelled || requestRevision !== revision) {
          await cleanupAttempt(attempt);
          throw new WebLlmError(
            "load-cancelled",
            "Model loading was cancelled.",
          );
        }
        return nextEngine;
      } catch (error) {
        await cleanupAttempt(attempt).catch(() => undefined);
        if (error instanceof WebLlmError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new WebLlmError(
          classifyLoadFailure(message),
          `WebLLM could not load ${modelId}: ${message}. Retry or choose Preset.`,
          { cause: error },
        );
      }
    },
    async unload() {
      revision += 1;
      await cleanupAll();
    },
    async dispose() {
      revision += 1;
      await cleanupAll();
    },
  };
}
