import { describe, expect, it, vi } from "vitest";
import { ModelType, prebuiltAppConfig, type ChatOptions } from "@mlc-ai/web-llm";
import {
  DEFAULT_WEBLLM_MODEL_ID,
  WEBLLM_CHAT_OPTIONS,
  WEBLLM_CONTEXT_WINDOW_SIZE,
  WEBLLM_MODELS,
  WEBLLM_PREBUILT_MODELS,
  WebLlmError,
  assertWebGpuSupport,
  createWebLlmRuntime,
  createWebWorkerEngine,
  findWebLlmModelRecord,
  getBrowserGpu,
  isWebLlmModelAvailable,
  isWebLlmModelCached,
  webLlmModelInfo,
  type WebLlmEngine,
  type WebLlmRuntimeDependencies,
  type WebWorkerEngineFactory,
} from "./webllm";

// A prebuilt model installed in @mlc-ai/web-llm but intentionally NOT in the
// curated list, so custom-ID tests exercise the general prebuilt path.
const NON_CURATED_MODEL_ID: string = "Qwen3-0.6B-q4f16_1-MLC";

describe("WebLLM model catalog", () => {
  it("uses the approved curated order and default", () => {
    expect(WEBLLM_MODELS.map(({ id }) => id)).toEqual([
      "Qwen3-4B-q4f16_1-MLC",
      "Phi-4-mini-instruct-q4f16_1-MLC",
      "Qwen3.5-2B-q4f16_1-MLC",
      "Qwen3.5-0.8B-q4f16_1-MLC",
      "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
      "SmolLM2-360M-Instruct-q4f16_1-MLC",
      "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    ]);
    expect(DEFAULT_WEBLLM_MODEL_ID).toBe("Qwen3-4B-q4f16_1-MLC");
  });

  it("resolves every curated model in the installed prebuilt config", () => {
    for (const { id } of WEBLLM_MODELS) {
      expect(
        prebuiltAppConfig.model_list.some((record) => record.model_id === id),
      ).toBe(true);
    }
  });

  it("resolves the added Qwen3.5 models with no required features", () => {
    for (const id of ["Qwen3.5-2B-q4f16_1-MLC", "Qwen3.5-0.8B-q4f16_1-MLC"]) {
      const record = prebuiltAppConfig.model_list.find(
        (entry) => entry.model_id === id,
      );
      expect(record).toBeDefined();
      expect(record?.required_features ?? []).toEqual([]);
    }
  });

  it("resolves the added Phi-4 Mini model with no required features", () => {
    const record = prebuiltAppConfig.model_list.find(
      (entry) => entry.model_id === "Phi-4-mini-instruct-q4f16_1-MLC",
    );
    expect(record).toBeDefined();
    expect(record?.required_features ?? []).toEqual([]);
  });

  it("resolves the default Qwen3 4B record and its feature requirements", () => {
    const record = prebuiltAppConfig.model_list.find(
      (entry) => entry.model_id === "Qwen3-4B-q4f16_1-MLC",
    );
    expect(record).toBeDefined();
    // The default loads on any WebGPU adapter: it declares no required features.
    expect(record?.required_features ?? []).toEqual([]);
  });

  it("describes memory as non-numeric relative guidance", () => {
    for (const { memory } of WEBLLM_MODELS) {
      expect(memory).not.toMatch(/\d|MB|GB/i);
      expect(memory).toMatch(/browser GPU footprint/i);
    }
    expect(WEBLLM_MODELS.map(({ memory }) => memory)).toEqual([
      "Largest browser GPU footprint",
      "Largest browser GPU footprint",
      "Large browser GPU footprint",
      "Moderate browser GPU footprint",
      "Moderate browser GPU footprint",
      "Moderate browser GPU footprint",
      "Smallest browser GPU footprint",
      "Large browser GPU footprint",
    ]);
  });
});

describe("WebLLM custom prebuilt model resolution", () => {
  it("finds an installed prebuilt model record by id", () => {
    const record = findWebLlmModelRecord(NON_CURATED_MODEL_ID);
    expect(record).toBeDefined();
    expect(record?.model_id).toBe(NON_CURATED_MODEL_ID);
    expect(
      WEBLLM_MODELS.some(({ id }) => id === NON_CURATED_MODEL_ID),
    ).toBe(false);
  });

  it("returns undefined for an unknown model id", () => {
    expect(findWebLlmModelRecord("totally-made-up-model")).toBeUndefined();
    expect(findWebLlmModelRecord("")).toBeUndefined();
  });

  it("reports availability for installed, unknown, and blank ids", () => {
    expect(isWebLlmModelAvailable(NON_CURATED_MODEL_ID)).toBe(true);
    expect(isWebLlmModelAvailable(DEFAULT_WEBLLM_MODEL_ID)).toBe(true);
    expect(isWebLlmModelAvailable("nope-not-real")).toBe(false);
    expect(isWebLlmModelAvailable("")).toBe(false);
  });
});

describe("WEBLLM_PREBUILT_MODELS", () => {
  it("lists q4f16 LLM records with context windows above 4000 in catalog order", () => {
    const expected = prebuiltAppConfig.model_list.filter(
      (record) =>
        (record.model_type === undefined || record.model_type === ModelType.LLM) &&
        record.model_id.includes("q4f16") &&
        (record.overrides?.context_window_size ?? 0) > 4000,
    );
    expect(WEBLLM_PREBUILT_MODELS.map((record) => record.model_id)).toEqual(
      expected.map((record) => record.model_id),
    );
    expect(WEBLLM_PREBUILT_MODELS).toHaveLength(56);
    expect(
      WEBLLM_PREBUILT_MODELS.every(
        (record) =>
          (record.model_type === undefined || record.model_type === ModelType.LLM) &&
          record.model_id.includes("q4f16") &&
          (record.overrides?.context_window_size ?? 0) > 4000,
      ),
    ).toBe(true);
  });

  it("contains every curated model and the default, and is longer than the curated list", () => {
    for (const { id } of WEBLLM_MODELS) {
      expect(
        WEBLLM_PREBUILT_MODELS.some((record) => record.model_id === id),
      ).toBe(true);
    }
    expect(
      WEBLLM_PREBUILT_MODELS.some(
        (record) => record.model_id === DEFAULT_WEBLLM_MODEL_ID,
      ),
    ).toBe(true);
    expect(WEBLLM_PREBUILT_MODELS.length).toBeGreaterThan(WEBLLM_MODELS.length);
  });

  it("does not mutate the installed prebuilt config", () => {
    expect(prebuiltAppConfig.model_list.length).toBe(163);
  });
});

describe("isWebLlmModelCached", () => {
  it("delegates to the official cache check with the prebuilt app config", async () => {
    const check = vi.fn(async () => true);
    await expect(
      isWebLlmModelCached(DEFAULT_WEBLLM_MODEL_ID, check),
    ).resolves.toBe(true);
    expect(check).toHaveBeenCalledWith(DEFAULT_WEBLLM_MODEL_ID, prebuiltAppConfig);
  });

  it("resolves false when the official check reports no cache entry", async () => {
    const check = vi.fn(async () => false);
    await expect(isWebLlmModelCached("anything", check)).resolves.toBe(false);
  });

  it("propagates a cache-check rejection to the caller", async () => {
    const check = vi.fn(async () => {
      throw new Error("cache read failed");
    });
    await expect(
      isWebLlmModelCached(DEFAULT_WEBLLM_MODEL_ID, check),
    ).rejects.toThrow("cache read failed");
  });
});

describe("webLlmModelInfo", () => {
  it("returns curated metadata for a curated model", () => {
    const info = webLlmModelInfo(DEFAULT_WEBLLM_MODEL_ID);
    expect(info.label).toBe("Qwen3 4B");
    expect(info.memory).toBe("Largest browser GPU footprint");
  });

  it("labels a non-curated prebuilt id with the id and generic guidance", () => {
    const info = webLlmModelInfo(NON_CURATED_MODEL_ID);
    expect(info.id).toBe(NON_CURATED_MODEL_ID);
    expect(info.label).toBe(NON_CURATED_MODEL_ID);
    expect(info.memory).toBe("WebLLM prebuilt model");
    expect(info.memory).not.toMatch(/custom/i);
    expect(info.note).not.toMatch(/custom/i);
  });
});

describe("WebLLM chat options", () => {
  it("pins the curated context window to 8192 tokens", () => {
    expect(WEBLLM_CONTEXT_WINDOW_SIZE).toBe(8192);
    expect(WEBLLM_CHAT_OPTIONS).toEqual({ context_window_size: 8192 });
  });

  it("freezes the shared chat options so callers cannot mutate them", () => {
    expect(Object.isFrozen(WEBLLM_CHAT_OPTIONS)).toBe(true);
  });

  it("passes the explicit chat options through to CreateWebWorkerMLCEngine", async () => {
    const engine = fakeEngine();
    const create = vi.fn<WebWorkerEngineFactory>(async () => engine);
    const worker = {} as unknown as Worker;
    const config = { initProgressCallback: vi.fn() };
    await expect(
      createWebWorkerEngine(
        worker,
        DEFAULT_WEBLLM_MODEL_ID,
        config,
        WEBLLM_CHAT_OPTIONS,
        create,
      ),
    ).resolves.toBe(engine);
    expect(create).toHaveBeenCalledWith(
      worker,
      DEFAULT_WEBLLM_MODEL_ID,
      config,
      WEBLLM_CHAT_OPTIONS,
    );
    const chatOpts = create.mock.calls[0]?.[3] as ChatOptions;
    expect(chatOpts).toEqual({ context_window_size: 8192 });
  });
});

describe("getBrowserGpu", () => {
  it("returns undefined when the environment lacks WebGPU", () => {
    expect(getBrowserGpu()).toBeUndefined();
  });
});

describe("assertWebGpuSupport", () => {
  it("rejects a browser without WebGPU", async () => {
    await expect(assertWebGpuSupport(undefined)).rejects.toMatchObject({
      code: "webgpu-unavailable",
    } satisfies Partial<WebLlmError>);
  });

  it("rejects when no WebGPU adapter is available", async () => {
    await expect(
      assertWebGpuSupport({ requestAdapter: async () => null }),
    ).rejects.toMatchObject({ code: "webgpu-unavailable" });
  });

  it("wraps a rejected adapter request as an actionable WebGPU error", async () => {
    const cause = new Error("adapter denied");
    await expect(
      assertWebGpuSupport({
        requestAdapter: async () => {
          throw cause;
        },
      }),
    ).rejects.toMatchObject({ code: "webgpu-unavailable", cause });
  });

  it("rejects a model missing from the prebuilt config", async () => {
    await expect(
      assertWebGpuSupport(
        {
          requestAdapter: async () => ({ features: new Set<string>() }),
        },
        "does-not-exist-model" as (typeof WEBLLM_MODELS)[number]["id"],
      ),
    ).rejects.toMatchObject({ code: "model-unavailable" });
  });

  it("accepts the default model on an adapter without shader-f16", async () => {
    await expect(
      assertWebGpuSupport({
        requestAdapter: async () => ({ features: new Set<string>() }),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a shader-f16 model on an adapter without shader-f16", async () => {
    await expect(
      assertWebGpuSupport(
        {
          requestAdapter: async () => ({ features: new Set<string>() }),
        },
        "SmolLM2-360M-Instruct-q4f16_1-MLC",
      ),
    ).rejects.toMatchObject({ code: "feature-unavailable" });
  });

  it("accepts a shader-f16 model on an adapter with shader-f16", async () => {
    await expect(
      assertWebGpuSupport(
        {
          requestAdapter: async () => ({
            features: new Set(["shader-f16"]),
          }),
        },
        "SmolLM2-360M-Instruct-q4f16_1-MLC",
      ),
    ).resolves.toBeUndefined();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeEngine() {
  return {
    unload: vi.fn(async () => undefined),
    chat: { completions: { create: vi.fn() } },
  } as unknown as WebLlmEngine;
}

type FakeWorker = {
  terminate: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  emit: (type: string, event: unknown) => void;
  listenerCount: (type: string) => number;
};

function fakeWorker(): FakeWorker {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    terminate: vi.fn(),
    addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set<(event: unknown) => void>();
      set.add(handler);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn(
      (type: string, handler: (event: unknown) => void) => {
        listeners.get(type)?.delete(handler);
      },
    ),
    emit: (type, event) => {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
  };
}

function runtimeHarness() {
  const workers = Array.from({ length: 3 }, () => fakeWorker());
  const engines = [fakeEngine(), fakeEngine(), fakeEngine()];
  let workerIndex = 0;
  let engineIndex = 0;
  const dependencies: WebLlmRuntimeDependencies = {
    getGpu: () => ({
      requestAdapter: async () => ({ features: new Set(["shader-f16"]) }),
    }),
    createWorker: () => workers[workerIndex++] as unknown as Worker,
    createEngine: vi.fn(async (_worker, _modelId, config, _chatOpts) => {
      config.initProgressCallback({
        progress: 0.5,
        timeElapsed: 1,
        text: "Loading model",
      });
      return engines[engineIndex++];
    }),
  };
  return { dependencies, workers, engines };
}

describe("WebLLM custom model loading", () => {
  it("rejects an unknown model id before creating a worker", async () => {
    const createWorker = vi.fn(() => {
      throw new Error("createWorker must not run for an unknown model");
    });
    const createEngine = vi.fn();
    const runtime = createWebLlmRuntime({
      getGpu: () => ({
        requestAdapter: async () => ({ features: new Set<string>() }),
      }),
      createWorker: createWorker as unknown as () => Worker,
      createEngine: createEngine as unknown as WebLlmRuntimeDependencies["createEngine"],
    });
    await expect(
      runtime.load("does-not-exist-model", vi.fn()),
    ).rejects.toMatchObject({ code: "model-unavailable" });
    expect(createWorker).not.toHaveBeenCalled();
    expect(createEngine).not.toHaveBeenCalled();
    expect(runtime.current()).toBeNull();
  });

  it("loads an installed non-curated prebuilt model", async () => {
    const { dependencies, engines } = runtimeHarness();
    const runtime = createWebLlmRuntime(dependencies);
    await expect(
      runtime.load(NON_CURATED_MODEL_ID, vi.fn()),
    ).resolves.toBe(engines[0]);
    expect(dependencies.createEngine).toHaveBeenCalledWith(
      expect.anything(),
      NON_CURATED_MODEL_ID,
      expect.objectContaining({
        initProgressCallback: expect.any(Function),
      }),
      WEBLLM_CHAT_OPTIONS,
    );
    expect(runtime.current()).toBe(engines[0]);
  });
});

describe("WebLLM runtime lifecycle", () => {
  it("forwards load progress and retains the ready engine", async () => {
    const { dependencies, engines } = runtimeHarness();
    const runtime = createWebLlmRuntime(dependencies);
    const progress = vi.fn();
    await expect(
      runtime.load(DEFAULT_WEBLLM_MODEL_ID, progress),
    ).resolves.toBe(engines[0]);
    expect(progress).toHaveBeenCalledWith({
      progress: 0.5,
      timeElapsed: 1,
      text: "Loading model",
    });
    expect(runtime.current()).toBe(engines[0]);
  });

  it("creates the engine with the explicit 8192 context window", async () => {
    const { dependencies, engines } = runtimeHarness();
    const runtime = createWebLlmRuntime(dependencies);
    await expect(
      runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn()),
    ).resolves.toBe(engines[0]);
    expect(dependencies.createEngine).toHaveBeenCalledWith(
      expect.anything(),
      DEFAULT_WEBLLM_MODEL_ID,
      expect.objectContaining({
        initProgressCallback: expect.any(Function),
      }),
      WEBLLM_CHAT_OPTIONS,
    );
    const chatOpts = vi.mocked(dependencies.createEngine).mock.calls[0]?.[3];
    expect(chatOpts).toEqual({ context_window_size: 8192 });
  });

  it("checks per-model WebGPU feature requirements before loading", async () => {
    const { dependencies, workers } = runtimeHarness();
    dependencies.getGpu = () => ({
      requestAdapter: async () => ({ features: new Set<string>() }),
    });
    const runtime = createWebLlmRuntime(dependencies);
    await expect(
      runtime.load("SmolLM2-360M-Instruct-q4f16_1-MLC", vi.fn()),
    ).rejects.toMatchObject({ code: "feature-unavailable" });
    expect(dependencies.createEngine).not.toHaveBeenCalled();
    expect(workers[0].terminate).not.toHaveBeenCalled();
    expect(runtime.current()).toBeNull();
  });

  it("unloads the engine and terminates the worker on model change", async () => {
    const { dependencies, workers, engines } = runtimeHarness();
    const runtime = createWebLlmRuntime(dependencies);
    await runtime.load(WEBLLM_MODELS[0].id, vi.fn());
    await runtime.load(WEBLLM_MODELS[1].id, vi.fn());
    expect(engines[0].unload).toHaveBeenCalledOnce();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(runtime.current()).toBe(engines[1]);
  });

  it("terminates a failed worker and classifies a storage failure", async () => {
    const { dependencies, workers } = runtimeHarness();
    dependencies.createEngine = vi.fn(async () => {
      throw new Error("IndexedDB quota exceeded");
    });
    const runtime = createWebLlmRuntime(dependencies);
    await expect(
      runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn()),
    ).rejects.toMatchObject({ code: "storage-failed" });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(runtime.current()).toBeNull();
  });

  it("classifies a worker channel failure", async () => {
    const { dependencies, workers } = runtimeHarness();
    dependencies.createEngine = vi.fn(async () => {
      throw new Error("The worker message channel was terminated");
    });
    const runtime = createWebLlmRuntime(dependencies);
    await expect(
      runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn()),
    ).rejects.toMatchObject({ code: "worker-failed" });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(runtime.current()).toBeNull();
  });

  it("classifies a generic load failure as model-load-failed", async () => {
    const { dependencies } = runtimeHarness();
    dependencies.createEngine = vi.fn(async () => {
      throw new Error("Shader compilation failed");
    });
    const runtime = createWebLlmRuntime(dependencies);
    await expect(
      runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn()),
    ).rejects.toMatchObject({ code: "model-load-failed" });
  });

  it("cancels a never-settling load and still creates the next model", async () => {
    const { dependencies, workers, engines } = runtimeHarness();
    const second = deferred<WebLlmEngine>();
    dependencies.createEngine = vi
      .fn()
      // The first engine RPC never settles once its worker is terminated.
      .mockImplementationOnce(() => new Promise<WebLlmEngine>(() => {}))
      .mockImplementationOnce(() => second.promise);
    const runtime = createWebLlmRuntime(dependencies);

    const firstLoad = runtime.load(WEBLLM_MODELS[0].id, vi.fn());
    await vi.waitFor(() => {
      expect(dependencies.createEngine).toHaveBeenCalledTimes(1);
    });
    const secondLoad = runtime.load(WEBLLM_MODELS[1].id, vi.fn());
    expect(workers[0].terminate).toHaveBeenCalledOnce();

    await expect(firstLoad).rejects.toMatchObject({ code: "load-cancelled" });
    await vi.waitFor(() => {
      expect(dependencies.createEngine).toHaveBeenCalledTimes(2);
    });
    second.resolve(engines[1]);
    await expect(secondLoad).resolves.toBe(engines[1]);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(runtime.current()).toBe(engines[1]);
  }, 2000);

  it("cancels a never-settling load on unload without awaiting its engine", async () => {
    const { dependencies, workers } = runtimeHarness();
    // Terminating the worker leaves the engine RPC unsettled forever.
    dependencies.createEngine = vi.fn(() => new Promise<WebLlmEngine>(() => {}));
    const runtime = createWebLlmRuntime(dependencies);

    const load = runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());
    await vi.waitFor(() =>
      expect(dependencies.createEngine).toHaveBeenCalledOnce(),
    );
    const unload = runtime.unload();
    expect(workers[0].terminate).toHaveBeenCalledOnce();

    await expect(load).rejects.toMatchObject({ code: "load-cancelled" });
    await expect(unload).resolves.toBeUndefined();
    expect(runtime.current()).toBeNull();
  }, 2000);

  it("cancels a never-settling load on dispose without awaiting its engine", async () => {
    const { dependencies, workers } = runtimeHarness();
    dependencies.createEngine = vi.fn(() => new Promise<WebLlmEngine>(() => {}));
    const runtime = createWebLlmRuntime(dependencies);

    const load = runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());
    await vi.waitFor(() =>
      expect(dependencies.createEngine).toHaveBeenCalledOnce(),
    );
    const dispose = runtime.dispose();
    expect(workers[0].terminate).toHaveBeenCalledOnce();

    await expect(load).rejects.toMatchObject({ code: "load-cancelled" });
    await expect(dispose).resolves.toBeUndefined();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(runtime.current()).toBeNull();
  }, 2000);

  it("unloads a ready engine before terminating its worker on dispose", async () => {
    const { dependencies, workers, engines } = runtimeHarness();
    const runtime = createWebLlmRuntime(dependencies);
    await runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());
    expect(runtime.current()).toBe(engines[0]);
    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(engines[0].unload).toHaveBeenCalledOnce();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const unloadOrder = vi.mocked(engines[0].unload).mock.invocationCallOrder[0];
    const terminateOrder = workers[0].terminate.mock.invocationCallOrder[0];
    expect(unloadOrder).toBeLessThan(terminateOrder);
    expect(runtime.current()).toBeNull();
  });

  it("stays idempotent across repeated unload and dispose calls", async () => {
    const { dependencies, workers, engines } = runtimeHarness();
    const runtime = createWebLlmRuntime(dependencies);
    await runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());
    await runtime.unload();
    await runtime.unload();
    await runtime.dispose();
    expect(engines[0].unload).toHaveBeenCalledOnce();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(runtime.current()).toBeNull();
  });

  it("surfaces a resolved engine's unload failure as termination-failed", async () => {
    const { dependencies, workers, engines } = runtimeHarness();
    vi.mocked(engines[0].unload).mockRejectedValueOnce(
      new Error("device disconnect"),
    );
    const runtime = createWebLlmRuntime(dependencies);
    await runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());
    await expect(runtime.dispose()).rejects.toMatchObject({
      code: "termination-failed",
    });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(runtime.current()).toBeNull();
  });

  it("maps a worker constructor failure to a worker-failed error", async () => {
    const { dependencies, workers } = runtimeHarness();
    const cause = new Error("Worker constructor blew up");
    dependencies.createWorker = () => {
      throw cause;
    };
    const runtime = createWebLlmRuntime(dependencies);
    await expect(
      runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn()),
    ).rejects.toMatchObject({ code: "worker-failed", cause });
    expect(dependencies.createEngine).not.toHaveBeenCalled();
    expect(workers[0].terminate).not.toHaveBeenCalled();
    expect(runtime.current()).toBeNull();
  });

  it("rejects a pending load when the worker emits a fatal error event", async () => {
    const { dependencies, workers } = runtimeHarness();
    // The engine RPC never settles; only the transport error can end the load.
    dependencies.createEngine = vi.fn(() => new Promise<WebLlmEngine>(() => {}));
    const runtime = createWebLlmRuntime(dependencies);

    const load = runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());
    await vi.waitFor(() =>
      expect(dependencies.createEngine).toHaveBeenCalledOnce(),
    );
    expect(workers[0].listenerCount("error")).toBe(1);
    workers[0].emit("error", new ErrorEvent("error", { message: "worker crashed" }));

    await expect(load).rejects.toMatchObject({ code: "worker-failed" });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[0].listenerCount("error")).toBe(0);
    expect(workers[0].listenerCount("messageerror")).toBe(0);
    expect(runtime.current()).toBeNull();
  }, 2000);

  it("rejects a pending load when the worker emits a messageerror event", async () => {
    const { dependencies, workers } = runtimeHarness();
    dependencies.createEngine = vi.fn(() => new Promise<WebLlmEngine>(() => {}));
    const runtime = createWebLlmRuntime(dependencies);

    const load = runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());
    await vi.waitFor(() =>
      expect(dependencies.createEngine).toHaveBeenCalledOnce(),
    );
    expect(workers[0].listenerCount("messageerror")).toBe(1);
    workers[0].emit("messageerror", new MessageEvent("messageerror"));

    await expect(load).rejects.toMatchObject({ code: "worker-failed" });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[0].listenerCount("error")).toBe(0);
    expect(workers[0].listenerCount("messageerror")).toBe(0);
    expect(runtime.current()).toBeNull();
  }, 2000);

  it("removes worker transport listeners when a ready engine is unloaded", async () => {
    const { dependencies, workers } = runtimeHarness();
    const runtime = createWebLlmRuntime(dependencies);
    await runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());
    expect(workers[0].listenerCount("error")).toBe(1);
    expect(workers[0].listenerCount("messageerror")).toBe(1);
    await runtime.unload();
    expect(workers[0].listenerCount("error")).toBe(0);
    expect(workers[0].listenerCount("messageerror")).toBe(0);
  });

  it("terminates a crashed ready worker without awaiting its dead unload RPC", async () => {
    const { dependencies, workers, engines } = runtimeHarness();
    // After the worker crashes, unload() would route through the dead worker
    // and never settle; cleanup must not await it.
    vi.mocked(engines[0].unload).mockImplementation(
      () => new Promise<void>(() => {}),
    );
    const runtime = createWebLlmRuntime(dependencies);
    await runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());
    expect(runtime.current()).toBe(engines[0]);

    workers[0].emit(
      "error",
      new ErrorEvent("error", { message: "worker crashed" }),
    );

    // Cleanup settles from the transport error alone, never blocking on unload.
    await vi.waitFor(() => expect(runtime.current()).toBeNull());
    expect(engines[0].unload).not.toHaveBeenCalled();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[0].listenerCount("error")).toBe(0);
    expect(workers[0].listenerCount("messageerror")).toBe(0);

    // A subsequent load must not hang on the dead attempt's orphaned RPC.
    await expect(runtime.load(WEBLLM_MODELS[1].id, vi.fn())).resolves.toBe(
      engines[1],
    );
    expect(runtime.current()).toBe(engines[1]);
  }, 2000);

  it("lets a worker crash cancel an in-flight normal unload without hanging", async () => {
    const { dependencies, workers, engines } = runtimeHarness();
    const unloadStarted = deferred<void>();
    // A normal unload begins, then the worker dies mid-RPC so unload never
    // settles. The shared cleanup must switch to termination without waiting.
    vi.mocked(engines[0].unload).mockImplementation(() => {
      unloadStarted.resolve();
      return new Promise<void>(() => {});
    });
    const runtime = createWebLlmRuntime(dependencies);
    await runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());

    const unload = runtime.unload();
    await unloadStarted.promise;
    expect(engines[0].unload).toHaveBeenCalledOnce();

    workers[0].emit(
      "error",
      new ErrorEvent("error", { message: "worker crashed" }),
    );

    await expect(unload).resolves.toBeUndefined();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[0].listenerCount("error")).toBe(0);
    expect(runtime.current()).toBeNull();
  }, 2000);

  it("consumes a late engine rejection after cancellation without an unhandled rejection", async () => {
    const { dependencies, workers } = runtimeHarness();
    const pending = deferred<WebLlmEngine>();
    dependencies.createEngine = vi.fn(() => pending.promise);
    const runtime = createWebLlmRuntime(dependencies);

    const load = runtime.load(DEFAULT_WEBLLM_MODEL_ID, vi.fn());
    await vi.waitFor(() =>
      expect(dependencies.createEngine).toHaveBeenCalledOnce(),
    );
    const unload = runtime.unload();
    await expect(load).rejects.toMatchObject({ code: "load-cancelled" });
    await expect(unload).resolves.toBeUndefined();

    // The orphaned engine RPC rejects only now; the runtime must swallow it or
    // Vitest fails the suite on the unhandled rejection.
    pending.reject(new Error("worker died after termination"));
    // Deterministically flush the orphan-guard microtasks without sleeping.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(workers[0].listenerCount("error")).toBe(0);
    expect(workers[0].listenerCount("messageerror")).toBe(0);
    expect(runtime.current()).toBeNull();
  });
});
