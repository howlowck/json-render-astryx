import { describe, expect, it, vi } from "vitest";
import { buildUserPrompt } from "@json-render/core";
import type { Spec } from "@json-render/react";
import { streamSpec } from "./generate";
import { systemPrompt } from "./registry";
import type { WebLlmEngine } from "./webllm";

function asyncChunks(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of chunks) {
        yield { choices: [{ delta: { content } }] };
      }
    },
  };
}

function fakeEngine(options: {
  streamChunks?: string[];
  staticText?: string;
  error?: Error;
}) {
  const create = vi.fn(async (request: { stream: boolean }) => {
    if (options.error) throw options.error;
    if (request.stream) return asyncChunks(options.streamChunks ?? []);
    return {
      choices: [{ message: { content: options.staticText ?? "" } }],
    };
  });
  return {
    engine: {
      chat: { completions: { create } },
    } as unknown as WebLlmEngine,
    create,
  };
}

const baseSpec: Spec = {
  root: "card",
  elements: {
    card: {
      type: "Card",
      props: {},
      children: ["cta"],
    },
    cta: {
      type: "Button",
      props: { label: "Old label", variant: "primary" },
      children: [],
    },
  },
};

function handlers() {
  return { onSpec: vi.fn(), onLines: vi.fn(), onPrompts: vi.fn() };
}

describe("streamSpec", () => {
  it("keeps Preset no-download and never touches an engine", async () => {
    const { engine, create } = fakeEngine({ error: new Error("must not run") });
    const callbacks = handlers();
    const result = await streamSpec(
      "a signup form",
      { source: "preset", stream: true, engine },
      null,
      callbacks,
    );
    expect(result.mode).toBe("mock");
    expect(result.reason).toContain("Switch to WebLLM in Settings");
    expect(result.spec.elements[result.spec.root]).toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });

  it("feeds streaming delta content through the real JSONL compiler", async () => {
    const root = '{"op":"add","path":"/root","value":"root"}\n';
    const elements = '{"op":"add","path":"/elements","value":{}}\n';
    const heading =
      '{"op":"add","path":"/elements/root","value":{"type":"Heading","props":{"level":2,"text":"Hello WebLLM"},"children":[]}}\n';
    const { engine } = fakeEngine({ streamChunks: [root, elements, heading] });
    const callbacks = handlers();
    const result = await streamSpec(
      "make a heading",
      { source: "webllm", stream: true, engine },
      null,
      callbacks,
    );
    expect(result.mode).toBe("live");
    expect(result.spec.elements.root.props).toMatchObject({
      text: "Hello WebLLM",
    });
    expect(result.lines).toHaveLength(3);
    expect(callbacks.onSpec).toHaveBeenCalled();
  });

  it("flushes a static one-line edit into the Stream pane", async () => {
    const patch =
      '{"op":"replace","path":"/elements/cta/props/label","value":"Continue"}';
    const { engine } = fakeEngine({ staticText: patch });
    const callbacks = handlers();
    const result = await streamSpec(
      "change the button label",
      { source: "webllm", stream: false, engine },
      baseSpec,
      callbacks,
    );
    expect(result.spec.elements.cta.props).toMatchObject({ label: "Continue" });
    expect(result.lines).toEqual([patch]);
    expect(callbacks.onLines).toHaveBeenCalledWith([patch]);
  });

  it("embeds the current spec in the patch Edit Mode user prompt", async () => {
    const patch =
      '{"op":"replace","path":"/elements/cta/props/label","value":"Save"}';
    const { engine, create } = fakeEngine({ staticText: patch });
    await streamSpec(
      "rename the button",
      { source: "webllm", stream: false, engine },
      baseSpec,
      handlers(),
    );
    const request = create.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
      stream: boolean;
    };
    expect(request.stream).toBe(false);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[1].content).toContain("Old label");
    expect(request.messages[1].content).toContain("rename the button");
  });

  it("captures the exact system and user prompts immediately before the engine call", async () => {
    const patch =
      '{"op":"replace","path":"/elements/cta/props/label","value":"Go"}';
    const { engine, create } = fakeEngine({ staticText: patch });
    const callbacks = handlers();
    await streamSpec(
      "rename the button",
      { source: "webllm", stream: false, engine },
      baseSpec,
      callbacks,
    );
    const expectedUserPrompt = buildUserPrompt({
      prompt: "rename the button",
      currentSpec: baseSpec,
      editModes: ["patch"],
    });
    expect(callbacks.onPrompts).toHaveBeenCalledTimes(1);
    expect(callbacks.onPrompts).toHaveBeenCalledWith({
      systemPrompt,
      userPrompt: expectedUserPrompt,
    });
    // The capture happens before the model request, not after it completes.
    const promptsOrder = callbacks.onPrompts.mock.invocationCallOrder[0];
    const createOrder = create.mock.invocationCallOrder[0];
    expect(promptsOrder).toBeLessThan(createOrder);
  });

  it("sends null prompts for Preset requests because no LLM prompt is used", async () => {
    const { engine, create } = fakeEngine({ error: new Error("must not run") });
    const callbacks = handlers();
    await streamSpec(
      "a signup form",
      { source: "preset", stream: true, engine },
      null,
      callbacks,
    );
    expect(callbacks.onPrompts).toHaveBeenCalledWith(null);
    expect(create).not.toHaveBeenCalled();
  });

  it("retains the captured prompts when the engine call fails", async () => {
    const { engine } = fakeEngine({ error: new Error("GPU device lost") });
    const callbacks = handlers();
    await expect(
      streamSpec(
        "make a UI",
        { source: "webllm", stream: true, engine },
        baseSpec,
        callbacks,
      ),
    ).rejects.toMatchObject({ code: "inference-failed" });
    const expectedUserPrompt = buildUserPrompt({
      prompt: "make a UI",
      currentSpec: baseSpec,
      editModes: ["patch"],
    });
    expect(callbacks.onPrompts).toHaveBeenCalledWith({
      systemPrompt,
      userPrompt: expectedUserPrompt,
    });
  });

  it("rejects malformed model output instead of returning a Preset mock", async () => {
    const { engine } = fakeEngine({ staticText: "not JSONL" });
    await expect(
      streamSpec(
        "make a UI",
        { source: "webllm", stream: false, engine },
        baseSpec,
        handlers(),
      ),
    ).rejects.toMatchObject({ code: "inference-failed" });
  });

  it("surfaces engine rejection instead of returning a Preset mock", async () => {
    const { engine } = fakeEngine({ error: new Error("GPU device lost") });
    await expect(
      streamSpec(
        "make a UI",
        { source: "webllm", stream: true, engine },
        baseSpec,
        handlers(),
      ),
    ).rejects.toMatchObject({
      code: "inference-failed",
      message: expect.stringContaining("GPU device lost"),
    });
  });

  it("snapshots each progressive spec so a later patch cannot mutate an earlier callback", async () => {
    const create =
      '{"op":"add","path":"/root","value":"card"}\n' +
      '{"op":"add","path":"/elements","value":{}}\n' +
      '{"op":"add","path":"/elements/card","value":{"type":"Card","props":{"title":"before"},"children":[]}}\n';
    const edit =
      '{"op":"replace","path":"/elements/card/props/title","value":"after"}\n';
    const { engine } = fakeEngine({ streamChunks: [create, edit] });
    const callbacks = handlers();
    const result = await streamSpec(
      "make a card",
      { source: "webllm", stream: true, engine },
      null,
      callbacks,
    );
    expect(result.spec.elements.card.props.title).toBe("after");
    // The first mountable snapshot was emitted before the title patch arrived;
    // it must still read "before" even though the compiler later mutated the
    // live spec to "after".
    const firstSnapshot = callbacks.onSpec.mock.calls[0][0] as Spec;
    expect(firstSnapshot.elements.card.props.title).toBe("before");
  });

  it("rejects an unsupported patch op on a seeded edit instead of a live unchanged spec", async () => {
    // The compiler counts this line in getPatches() but applies no mutation, so
    // the seeded baseSpec would masquerade as a successful live generation.
    const patch =
      '{"op":"move","from":"/elements/cta","path":"/elements/moved"}';
    const { engine } = fakeEngine({ staticText: patch });
    await expect(
      streamSpec(
        "reorganize the layout",
        { source: "webllm", stream: false, engine },
        baseSpec,
        handlers(),
      ),
    ).rejects.toMatchObject({ code: "inference-failed" });
  });

  it("includes a bounded raw model-output snippet when output has no valid patches", async () => {
    // Real models sometimes wrap patches in prose/markdown fences and emit zero
    // parseable JSONL. The error must carry the raw output as evidence so the
    // failure is diagnosable instead of a generic "no patches" message.
    const garbage = "Here is your UI:\n```json\n[...]";
    const { engine } = fakeEngine({ staticText: garbage });
    await expect(
      streamSpec(
        "make a UI",
        { source: "webllm", stream: false, engine },
        null,
        handlers(),
      ),
    ).rejects.toMatchObject({
      code: "inference-failed",
      message: expect.stringContaining("Model output: Here is your UI:"),
    });
  });

  it("escapes newlines in the raw snippet so the diagnostic stays one readable line", async () => {
    const garbage = "line one\nline two\n```json\n[...]";
    const { engine } = fakeEngine({ staticText: garbage });
    await expect(
      streamSpec(
        "make a UI",
        { source: "webllm", stream: false, engine },
        null,
        handlers(),
      ),
    ).rejects.toMatchObject({
      code: "inference-failed",
      message: expect.stringContaining("line one\\nline two"),
    });
  });

  it("reports (empty) model output when the response is blank", async () => {
    const { engine } = fakeEngine({ staticText: "" });
    await expect(
      streamSpec(
        "make a UI",
        { source: "webllm", stream: false, engine },
        null,
        handlers(),
      ),
    ).rejects.toMatchObject({
      code: "inference-failed",
      message: expect.stringContaining("Model output: (empty)"),
    });
  });

  it("bounds the raw model-output snippet in the diagnostic error", async () => {
    const garbage = "x".repeat(5000);
    const { engine } = fakeEngine({ staticText: garbage });
    const error = (await streamSpec(
      "make a UI",
      { source: "webllm", stream: false, engine },
      null,
      handlers(),
    ).catch((thrown) => thrown)) as Error;
    // The 5000-char raw output must be truncated to a bounded snippet, not
    // echoed in full into the error message.
    expect(error.message.length).toBeLessThan(1000);
    expect(error.message).toContain("Model output: xxxx");
  });

  it("includes the raw snippet when patches never form a mountable spec", async () => {
    // A single supported "add" op passes the zero-patch and unsupported-op
    // checks but yields a spec with no root element — the nonmountable path
    // must also surface the raw output as evidence.
    const patch = '{"op":"add","path":"/foo","value":1}';
    const { engine } = fakeEngine({ staticText: patch });
    await expect(
      streamSpec(
        "make a UI",
        { source: "webllm", stream: false, engine },
        null,
        handlers(),
      ),
    ).rejects.toMatchObject({
      code: "inference-failed",
      message: expect.stringContaining('Model output: {"op":"add"'),
    });
  });
});
