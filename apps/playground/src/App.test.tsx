import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Spec } from "@json-render/react";
import type { ModelRecord } from "@mlc-ai/web-llm";
import { App, type AppProps } from "./App";
import { matchMockSpec } from "./mocks";
import type { StreamResult } from "./generate";
import { WebLlmError, type WebLlmEngine, type WebLlmRuntime } from "./webllm";

// Astryx theme/popover hooks call matchMedia, which jsdom does not implement.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// Astryx's streaming chat list observes element resizes; jsdom lacks the API.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// A short, real-id prebuilt catalog so tests exercise the listbox without
// rendering ~160 rows. All ids exist in the installed WebLLM prebuilt LLM list,
// so persistence (validated against the real catalog) accepts them.
const TEST_MODELS = [
  { model_id: "Qwen3-4B-q4f16_1-MLC" },
  { model_id: "SmolLM2-360M-Instruct-q4f16_1-MLC" },
  { model_id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC" },
] as unknown as ModelRecord[];

/** Render App with the short catalog and an injected cache checker so tests
 *  never touch the real Cache/IndexedDB API. */
function renderApp(props: Partial<AppProps> = {}) {
  const modelCacheChecker =
    props.modelCacheChecker ?? vi.fn(async () => false);
  const modelRecords = props.modelRecords ?? TEST_MODELS;
  const utils = render(
    <App
      {...props}
      modelRecords={modelRecords}
      modelCacheChecker={modelCacheChecker}
    />,
  );
  return { ...utils, modelCacheChecker };
}

function fakeRuntime() {
  const engine = {
    chat: { completions: { create: vi.fn() } },
    unload: vi.fn(async () => undefined),
  } as unknown as WebLlmEngine;
  const runtime: WebLlmRuntime = {
    current: vi.fn(() => engine),
    load: vi.fn(async (_modelId, onProgress) => {
      onProgress({ progress: 0.5, timeElapsed: 1, text: "Loading model" });
      return engine;
    }),
    unload: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  return { runtime, engine };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function selectWebLlm() {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const webLlm = screen.getByRole("radio", { name: "WebLLM" });
  fireEvent.click(webLlm);
  expect(webLlm.getAttribute("aria-checked")).toBe("true");
}

/** The listbox option whose accessible name contains the exact model id. */
function modelOption(modelId: string): HTMLElement {
  const escaped = modelId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return screen.getByRole("option", { name: new RegExp(escaped) });
}

describe("App WebLLM lifecycle", () => {
  it("defaults to Preset and does not auto-load WebLLM", () => {
    const { runtime } = fakeRuntime();
    renderApp({ runtimeFactory: () => runtime });
    expect(
      screen.getByText("Render built-in sample UIs — no model required."),
    ).toBeTruthy();
    expect(runtime.load).not.toHaveBeenCalled();
  });

  it("renders a scrollable model listbox and waits for explicit Load model", () => {
    const { runtime } = fakeRuntime();
    const { container } = renderApp({ runtimeFactory: () => runtime });
    selectWebLlm();
    expect(
      screen.getByRole("listbox", { name: "WebLLM model" }),
    ).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(
      ["true", "false", "false"],
    );
    // Accessible names carry the exact prebuilt ids; the default is selected.
    expect(modelOption("Qwen3-4B-q4f16_1-MLC").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(modelOption("SmolLM2-360M-Instruct-q4f16_1-MLC")).toBeTruthy();
    // No native select and no custom-id editor remain.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByLabelText("Custom WebLLM model ID")).toBeNull();
    expect(runtime.load).not.toHaveBeenCalled();
    const composer = container.querySelector(
      '[contenteditable="true"], [contenteditable="false"]',
    );
    expect(
      composer?.getAttribute("aria-disabled") === "true" ||
        composer?.getAttribute("contenteditable") === "false",
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Load model" })).toBeTruthy();
  });

  it("reports progress and enables generation only after ready", async () => {
    const { runtime, engine } = fakeRuntime();
    const pending = deferred<WebLlmEngine>();
    runtime.load = vi.fn(async (_modelId, onProgress) => {
      onProgress({ progress: 0.5, timeElapsed: 1, text: "Loading model" });
      return pending.promise;
    });
    const { container } = renderApp({ runtimeFactory: () => runtime });
    selectWebLlm();
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await waitFor(() => expect(runtime.load).toHaveBeenCalledOnce());
    expect(await screen.findByText("Loading model")).toBeTruthy();
    const progress = screen.getByRole("progressbar") as HTMLProgressElement;
    expect(progress.value).toBe(0.5);
    pending.resolve(engine);
    expect(await screen.findByText("Model ready")).toBeTruthy();
    const composer = container.querySelector('[contenteditable="true"]');
    expect(composer).not.toBeNull();
    expect(composer?.getAttribute("aria-disabled")).not.toBe("true");
    expect(screen.getAllByText("Qwen3 4B").length).toBeGreaterThan(0);
  });

  it("unloads and returns to idle when a different model option is chosen", async () => {
    const { runtime } = fakeRuntime();
    renderApp({ runtimeFactory: () => runtime });
    selectWebLlm();
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Model ready");
    fireEvent.click(modelOption("SmolLM2-360M-Instruct-q4f16_1-MLC"));
    await waitFor(() => expect(runtime.unload).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Load model" })).toBeTruthy();
    expect(screen.queryByText("Model ready")).toBeNull();
    // Selecting a model never triggers a download: only the initial load ran.
    expect(runtime.load).toHaveBeenCalledOnce();
  });

  it("selecting a model option persists it and unloads without downloading", async () => {
    const { runtime } = fakeRuntime();
    renderApp({ runtimeFactory: () => runtime });
    selectWebLlm();
    fireEvent.click(modelOption("SmolLM2-360M-Instruct-q4f16_1-MLC"));
    await waitFor(() => expect(runtime.unload).toHaveBeenCalledOnce());
    expect(runtime.load).not.toHaveBeenCalled();
    expect(localStorage.getItem("astryx-playground-webllm-model")).toBe(
      "SmolLM2-360M-Instruct-q4f16_1-MLC",
    );
    expect(
      modelOption("SmolLM2-360M-Instruct-q4f16_1-MLC").getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
  });

  it("disables model options while a load is in progress", async () => {
    const { runtime, engine } = fakeRuntime();
    const pending = deferred<WebLlmEngine>();
    runtime.load = vi.fn(async (_modelId, onProgress) => {
      onProgress({ progress: 0.5, timeElapsed: 1, text: "Loading model" });
      return pending.promise;
    });
    renderApp({ runtimeFactory: () => runtime });
    selectWebLlm();
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Loading model");
    for (const option of screen.getAllByRole("option")) {
      expect((option as HTMLButtonElement).disabled).toBe(true);
    }
    pending.resolve(engine);
    await screen.findByText("Model ready");
  });

  it("marks only cached models with a downloaded indicator without downloading", async () => {
    const { runtime } = fakeRuntime();
    const modelCacheChecker = vi.fn(
      async (id: string) => id === "SmolLM2-360M-Instruct-q4f16_1-MLC",
    );
    renderApp({ runtimeFactory: () => runtime, modelCacheChecker });
    selectWebLlm();
    await waitFor(() =>
      expect(modelCacheChecker).toHaveBeenCalledWith("Qwen3-4B-q4f16_1-MLC"),
    );
    const downloaded = await screen.findAllByLabelText("Downloaded");
    expect(downloaded).toHaveLength(1);
    expect(
      modelOption("SmolLM2-360M-Instruct-q4f16_1-MLC").contains(downloaded[0]),
    ).toBe(true);
    // Every listed model is inspected, and inspection never loads a model.
    expect(modelCacheChecker).toHaveBeenCalledTimes(3);
    expect(runtime.load).not.toHaveBeenCalled();
  });

  it("treats a per-model cache-check failure as not downloaded", async () => {
    const { runtime } = fakeRuntime();
    const modelCacheChecker = vi.fn(async (id: string) => {
      if (id === "SmolLM2-360M-Instruct-q4f16_1-MLC") {
        throw new Error("cache read failed");
      }
      return id === "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
    });
    renderApp({ runtimeFactory: () => runtime, modelCacheChecker });
    selectWebLlm();
    const downloaded = await screen.findAllByLabelText("Downloaded");
    expect(downloaded).toHaveLength(1);
    expect(
      modelOption("Qwen2.5-0.5B-Instruct-q4f16_1-MLC").contains(downloaded[0]),
    ).toBe(true);
  });

  it("marks the selected model downloaded after a successful load", async () => {
    const { runtime } = fakeRuntime();
    const modelCacheChecker = vi.fn(async () => false);
    renderApp({ runtimeFactory: () => runtime, modelCacheChecker });
    selectWebLlm();
    await waitFor(() => expect(modelCacheChecker).toHaveBeenCalled());
    expect(screen.queryByLabelText("Downloaded")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Model ready");
    const downloaded = await screen.findAllByLabelText("Downloaded");
    expect(downloaded).toHaveLength(1);
    expect(modelOption("Qwen3-4B-q4f16_1-MLC").contains(downloaded[0])).toBe(
      true,
    );
  });

  it("keeps the loaded model marked when a stale cache scan resolves false", async () => {
    const { runtime } = fakeRuntime();
    // A cache checker whose per-model resolutions we control, so the scan can
    // still be pending when the load completes and resolve stale afterwards.
    const scans: {
      id: string;
      resolve: (cached: boolean) => void;
      promise: Promise<boolean>;
    }[] = [];
    const modelCacheChecker = vi.fn((id: string) => {
      const control = deferred<boolean>();
      scans.push({ id, resolve: control.resolve, promise: control.promise });
      return control.promise;
    });
    renderApp({ runtimeFactory: () => runtime, modelCacheChecker });
    selectWebLlm();
    // The scan has started for every model but has not resolved yet.
    await waitFor(() => expect(scans).toHaveLength(3));
    expect(screen.queryByLabelText("Downloaded")).toBeNull();
    // Load the selected model; the runtime resolves ready, marking it cached.
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Model ready");
    const downloaded = await screen.findAllByLabelText("Downloaded");
    expect(downloaded).toHaveLength(1);
    expect(modelOption("Qwen3-4B-q4f16_1-MLC").contains(downloaded[0])).toBe(
      true,
    );
    // The scan that began before the load now resolves stale "not cached" for
    // every model. It must not remove the model the load just marked.
    await act(async () => {
      for (const scan of scans) scan.resolve(false);
      await Promise.all(scans.map((scan) => scan.promise));
      await Promise.resolve();
      await Promise.resolve();
    });
    const still = screen.queryAllByLabelText("Downloaded");
    expect(still).toHaveLength(1);
    expect(modelOption("Qwen3-4B-q4f16_1-MLC").contains(still[0])).toBe(true);
  });

  it("keeps WebLLM selected on load error and offers both recovery actions", async () => {
    const { runtime } = fakeRuntime();
    runtime.load = vi.fn(async () => {
      throw new Error("Model download failed");
    });
    renderApp({ runtimeFactory: () => runtime });
    selectWebLlm();
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    expect(await screen.findByText(/Model download failed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Preset" })).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "WebLLM model" })).toBeTruthy();
    expect(localStorage.getItem("astryx-playground-webllm-source")).toBe(
      "webllm",
    );
  });

  it("persists source and model but never persists ready state", async () => {
    const { runtime } = fakeRuntime();
    const first = renderApp({ runtimeFactory: () => runtime });
    selectWebLlm();
    fireEvent.click(modelOption("Qwen2.5-0.5B-Instruct-q4f16_1-MLC"));
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Model ready");
    first.unmount();
    renderApp({ runtimeFactory: () => fakeRuntime().runtime });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      modelOption("Qwen2.5-0.5B-Instruct-q4f16_1-MLC").getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Load model" })).toBeTruthy();
    expect(screen.queryByText("Model ready")).toBeNull();
  });

  it("disposes the runtime when the app unmounts", () => {
    const { runtime } = fakeRuntime();
    const { unmount } = renderApp({ runtimeFactory: () => runtime });
    unmount();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("consumes a rejected disposal when the app unmounts", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const { runtime } = fakeRuntime();
      runtime.dispose = vi.fn(async () => {
        throw new Error("dispose failed");
      });
      const { unmount } = renderApp({ runtimeFactory: () => runtime });
      unmount();
      expect(runtime.dispose).toHaveBeenCalledOnce();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    expect(rejections).toEqual([]);
  });

  it("does not let a stale unload rejection overwrite a newer lifecycle", async () => {
    const { runtime } = fakeRuntime();
    const firstUnload = deferred<void>();
    runtime.unload = vi.fn(() => firstUnload.promise);
    renderApp({ runtimeFactory: () => runtime });
    selectWebLlm();
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Model ready");
    fireEvent.click(modelOption("SmolLM2-360M-Instruct-q4f16_1-MLC"));
    await waitFor(() => expect(runtime.unload).toHaveBeenCalledOnce());
    // A newer lifecycle supersedes the abandoned unload.
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Model ready");
    firstUnload.reject(new Error("unload failed"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/unload failed/)).toBeNull();
    expect(screen.getByText("Model ready")).toBeTruthy();
  });

  it("restores the prior spec and appends an assistant error after inference failure", async () => {
    const original = matchMockSpec("a signup form");
    const partial: Spec = JSON.parse(JSON.stringify(original)) as Spec;
    partial.elements.title.props = { level: 3, text: "Partial replacement" };
    const generate = vi
      .fn<
        (
          ...args: Parameters<typeof import("./generate").streamSpec>
        ) => Promise<StreamResult>
      >()
      .mockResolvedValueOnce({
        spec: original,
        mode: "mock",
        reason: "Preset mode",
        lines: [],
      })
      .mockImplementationOnce(async (_prompt, _config, _baseSpec, callbacks) => {
        callbacks.onSpec(partial);
        callbacks.onLines([
          '{"op":"replace","path":"/elements/title/props/text","value":"Partial replacement"}',
        ]);
        throw new WebLlmError(
          "inference-failed",
          "WebLLM generation failed: GPU device lost",
        );
      });
    const { runtime } = fakeRuntime();
    const { container } = renderApp({
      runtimeFactory: () => runtime,
      generate,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "A signup form with name, email, and a subscribe toggle",
      }),
    );
    expect(await screen.findByText("Create your account")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("radio", { name: "WebLLM" }));
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Model ready");

    const composer = container.querySelector('[contenteditable="true"]');
    expect(composer).not.toBeNull();
    fireEvent.input(composer!, {
      target: { textContent: "change the heading" },
    });
    fireEvent.keyDown(composer!, { key: "Enter", code: "Enter" });

    expect(
      await screen.findAllByText("WebLLM generation failed: GPU device lost"),
    ).toHaveLength(2);
    expect(screen.getByText("Create your account")).toBeTruthy();
    expect(screen.queryByText("Partial replacement")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Preset" })).toBeTruthy();
    expect(runtime.unload).toHaveBeenCalled();
  });

  it("preserves a user's live state edit when a streamed spec conflicts then fails", async () => {
    // A spec whose TextInput is two-way bound to `/email` and seeded via state.
    const boundSpec = {
      root: "card",
      state: { email: "seed@example.com" },
      elements: {
        card: { type: "Card", props: {}, children: ["stack"] },
        stack: {
          type: "Stack",
          props: { direction: "vertical", gap: 4 },
          children: ["title", "email"],
        },
        title: {
          type: "Heading",
          props: { level: 3, text: "Email preferences" },
          children: [],
        },
        email: {
          type: "TextInput",
          props: { label: "Email", value: { $bindState: "/email" } },
          children: [],
        },
      },
    } as unknown as Spec;

    // The streamed edit carries a conflicting `/state` value and a new heading.
    const conflicting = JSON.parse(JSON.stringify(boundSpec)) as Spec & {
      state: Record<string, unknown>;
    };
    conflicting.state.email = "streamed@example.com";
    conflicting.elements.title.props = { level: 3, text: "Streamed heading" };

    const generate = vi
      .fn<
        (
          ...args: Parameters<typeof import("./generate").streamSpec>
        ) => Promise<StreamResult>
      >()
      .mockResolvedValueOnce({
        spec: boundSpec,
        mode: "mock",
        reason: "Preset mode",
        lines: [],
      })
      .mockImplementationOnce(async (_prompt, _config, _baseSpec, callbacks) => {
        callbacks.onSpec(conflicting);
        throw new WebLlmError(
          "inference-failed",
          "WebLLM generation failed: GPU device lost",
        );
      });

    const { runtime } = fakeRuntime();
    const { container } = renderApp({
      runtimeFactory: () => runtime,
      generate,
    });

    // Preset generation establishes the bound spec and seeds its state.
    fireEvent.click(
      screen.getByRole("button", {
        name: "A signup form with name, email, and a subscribe toggle",
      }),
    );
    const emailInput = (await screen.findByLabelText(
      "Email",
    )) as HTMLInputElement;
    expect(emailInput.value).toBe("seed@example.com");

    // The user edits the state-bound field to a distinct live value.
    fireEvent.change(emailInput, {
      target: { value: "user-typed@example.com" },
    });
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "user-typed@example.com",
    );

    // Load WebLLM, then submit an edit whose stream conflicts and then fails.
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("radio", { name: "WebLLM" }));
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Model ready");

    const composer = container.querySelector('[contenteditable="true"]');
    expect(composer).not.toBeNull();
    fireEvent.input(composer!, {
      target: { textContent: "change the heading" },
    });
    fireEvent.keyDown(composer!, { key: "Enter", code: "Enter" });

    await screen.findAllByText("WebLLM generation failed: GPU device lost");

    // The prior visual spec is restored and the streamed heading is discarded.
    expect(screen.getByText("Email preferences")).toBeTruthy();
    expect(screen.queryByText("Streamed heading")).toBeNull();
    // The user's live edit survives the rolled-back transaction — it is neither
    // the streamed value nor the original seed.
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "user-typed@example.com",
    );
  });

  it("shows the exact captured prompts in the Code pane and clears them on New Conversation", async () => {
    // jsdom does not implement the async Clipboard API that CodeBlock's copy
    // affordance calls; stub it so we can assert the exact copyable text.
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const captured = {
      systemPrompt: "SYSTEM INSTRUCTION TEXT",
      userPrompt: "USER PROMPT TEXT",
    };
    const generate = vi
      .fn<
        (
          ...args: Parameters<typeof import("./generate").streamSpec>
        ) => Promise<StreamResult>
      >()
      .mockImplementation(async (_prompt, _config, _baseSpec, callbacks) => {
        callbacks.onPrompts(captured);
        const spec = matchMockSpec("a signup form");
        callbacks.onSpec(spec);
        return { spec, mode: "live", lines: [] };
      });
    const { runtime } = fakeRuntime();
    const { container } = renderApp({ runtimeFactory: () => runtime, generate });

    selectWebLlm();
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Model ready");

    const composer = container.querySelector('[contenteditable="true"]');
    fireEvent.input(composer!, { target: { textContent: "make a form" } });
    fireEvent.keyDown(composer!, { key: "Enter", code: "Enter" });
    await screen.findByText("Here's your UI — see the Preview.");

    // Open the Code pane's Prompt subview.
    fireEvent.click(screen.getByRole("radio", { name: "Code" }));
    fireEvent.click(screen.getByRole("radio", { name: "Prompt" }));
    expect(screen.getByText("System instruction")).toBeTruthy();
    expect(screen.getByText("User prompt")).toBeTruthy();

    // The two CodeBlocks copy the exact system and user prompt text.
    const copyButtons = screen.getAllByRole("button", { name: "Copy code" });
    expect(copyButtons).toHaveLength(2);
    fireEvent.click(copyButtons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "SYSTEM INSTRUCTION TEXT",
    );
    fireEvent.click(copyButtons[1]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "USER PROMPT TEXT",
    );

    // New Conversation clears the captured prompts.
    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    fireEvent.click(screen.getByRole("radio", { name: "Code" }));
    fireEvent.click(screen.getByRole("radio", { name: "Prompt" }));
    expect(
      screen.getByText("// No LLM prompt was sent for the latest request."),
    ).toBeTruthy();
    expect(screen.queryByText("System instruction")).toBeNull();
  });

  it("clears the captured prompts when a later Preset request sends none", async () => {
    const captured = {
      systemPrompt: "SYSTEM INSTRUCTION TEXT",
      userPrompt: "USER PROMPT TEXT",
    };
    const generate = vi
      .fn<
        (
          ...args: Parameters<typeof import("./generate").streamSpec>
        ) => Promise<StreamResult>
      >()
      .mockImplementation(async (_prompt, config, _baseSpec, callbacks) => {
        const spec = matchMockSpec("a signup form");
        if (config.source === "preset") {
          callbacks.onPrompts(null);
          callbacks.onSpec(spec);
          return { spec, mode: "mock", reason: "Preset mode", lines: [] };
        }
        callbacks.onPrompts(captured);
        callbacks.onSpec(spec);
        return { spec, mode: "live", lines: [] };
      });
    const { runtime } = fakeRuntime();
    const { container } = renderApp({ runtimeFactory: () => runtime, generate });

    // A WebLLM request captures the prompts.
    selectWebLlm();
    fireEvent.click(screen.getByRole("button", { name: "Load model" }));
    await screen.findByText("Model ready");
    const composer = container.querySelector('[contenteditable="true"]');
    fireEvent.input(composer!, { target: { textContent: "make a form" } });
    fireEvent.keyDown(composer!, { key: "Enter", code: "Enter" });
    await screen.findByText("Here's your UI — see the Preview.");
    fireEvent.click(screen.getByRole("radio", { name: "Code" }));
    fireEvent.click(screen.getByRole("radio", { name: "Prompt" }));
    expect(screen.getByText("System instruction")).toBeTruthy();

    // Switching to Preset and generating sends no LLM prompt, clearing the view.
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
    fireEvent.click(screen.getByRole("radio", { name: "Preset" }));
    const presetComposer = container.querySelector('[contenteditable="true"]');
    fireEvent.input(presetComposer!, { target: { textContent: "a signup form" } });
    fireEvent.keyDown(presetComposer!, { key: "Enter", code: "Enter" });
    await screen.findByText("Preset mode");
    fireEvent.click(screen.getByRole("radio", { name: "Code" }));
    fireEvent.click(screen.getByRole("radio", { name: "Prompt" }));
    expect(
      screen.getByText("// No LLM prompt was sent for the latest request."),
    ).toBeTruthy();
    expect(screen.queryByText("System instruction")).toBeNull();
  });
});
