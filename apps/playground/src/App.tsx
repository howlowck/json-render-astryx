import { useEffect, useRef, useState } from "react";
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
} from "@astryxdesign/core/Chat";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import {
  ActionProvider,
  Renderer,
  StateProvider,
  VisibilityProvider,
  createStateStore,
  type Spec,
  type StateStore,
} from "@json-render/react";
import type { ModelRecord } from "@mlc-ai/web-llm";
import {
  SparklesIcon,
  Cog6ToothIcon,
  BoltIcon,
  BoltSlashIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import { registry } from "./registry";
import { streamSpec, type LlmPrompts } from "./generate";
import {
  DEFAULT_WEBLLM_MODEL_ID,
  WEBLLM_PREBUILT_MODELS,
  WebLlmError,
  createWebLlmRuntime,
  isWebLlmModelCached,
  webLlmModelInfo,
  type WebLlmLoadableModelId,
  type WebLlmProgress,
  type WebLlmRuntime,
} from "./webllm";
import { GettingStartedPane, SpecPane } from "./CodePane";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  time: string;
  footer?: string;
  /** The spec this assistant turn produced, replayed as context on later turns. */
  spec?: Spec;
}

const SOURCE_STORAGE = "astryx-playground-webllm-source";
const MODEL_STORAGE = "astryx-playground-webllm-model";
const STREAM_STORAGE = "astryx-playground-stream";

const SUGGESTIONS = [
  "A signup form with name, email, and a subscribe toggle",
  "A revenue dashboard with metric cards and a table",
  "A user profile card with an avatar and a Pro badge",
  "A pricing section with three plan cards",
];

function stored(key: string, fallback: string): string {
  const value =
    typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  return value ?? fallback;
}

/** True when the id is one of the selectable prebuilt LLM records. */
function isSelectableModel(id: string): boolean {
  return WEBLLM_PREBUILT_MODELS.some((record) => record.model_id === id);
}

/** Read the persisted model, accepting any selectable prebuilt LLM id and
 *  falling back to the approved default when the stored value is unknown (e.g.
 *  an old key, a removed model, or a model missing from this WebLLM build). */
function storedModel(): WebLlmLoadableModelId {
  const value = stored(MODEL_STORAGE, DEFAULT_WEBLLM_MODEL_ID);
  return isSelectableModel(value) ? value : DEFAULT_WEBLLM_MODEL_ID;
}

type ModelLifecycle =
  | { status: "idle" }
  | { status: "loading"; progress: number; text: string }
  | { status: "ready" }
  | { status: "error"; message: string };

function now(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The `state` seed a completed spec carries (streamed in last as `/state`). */
function specState(spec: Spec | null): Record<string, unknown> {
  return (spec as { state?: Record<string, unknown> } | null)?.state ?? {};
}

/** Detach a state snapshot from the live store so later mutations can't touch
 *  it and a restore can't alias the store's internal object. */
function cloneState(state: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

export interface AppProps {
  /** Injectable runtime factory so tests supply a fake WebLLM lifecycle. */
  runtimeFactory?: () => WebLlmRuntime;
  /** Injectable generator so tests drive deterministic streaming outcomes. */
  generate?: typeof streamSpec;
  /** Selectable prebuilt LLM records; defaults to the full installed catalog.
   *  Tests pass a short list to avoid rendering the whole catalog. */
  modelRecords?: readonly ModelRecord[];
  /** Cache-membership check for a model id; defaults to WebLLM's official cache
   *  API wrapper. Injectable so tests never touch the real Cache/IndexedDB. */
  modelCacheChecker?: (modelId: string) => Promise<boolean>;
}

export function App({
  runtimeFactory = createWebLlmRuntime,
  generate = streamSpec,
  modelRecords = WEBLLM_PREBUILT_MODELS,
  modelCacheChecker = isWebLlmModelCached,
}: AppProps = {}) {
  const [runtime] = useState(runtimeFactory);
  // A stable state store owns the rendered UI's live state. Passing it to
  // `<StateProvider store={...}>` runs the provider in controlled mode, so a
  // streamed spec's changing `initialState` can never overwrite a value the
  // user is editing. We swap the instance (and remount via `specVersion`) only
  // at explicit seed/restore boundaries.
  const stateStoreRef = useRef<StateStore | null>(null);
  function activeStore(): StateStore {
    return (stateStoreRef.current ??= createStateStore({}));
  }
  // Bumped whenever a load is superseded (model change, error, teardown) so a
  // late progress/ready callback for an abandoned load is ignored.
  const loadRevision = useRef(0);
  // Tracks mount state so async lifecycle callbacks never touch state after the
  // component unmounts.
  const mounted = useRef(true);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [spec, setSpec] = useState<Spec | null>(null);
  const [specVersion, setSpecVersion] = useState(0);
  const [streamLines, setStreamLines] = useState<string[]>([]);
  // The exact prompts sent to the model on the latest WebLLM request, surfaced
  // in the Code pane. `null` when no LLM prompt was sent (Preset, or after New
  // Conversation).
  const [prompts, setPrompts] = useState<LlmPrompts | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("preview");
  const [model, setModel] = useState<WebLlmLoadableModelId>(storedModel);
  const [modelLifecycle, setModelLifecycle] = useState<ModelLifecycle>({
    status: "idle",
  });
  // Model ids whose weights are already in WebLLM's browser cache, shown with a
  // downloaded indicator. Populated by inspecting the cache (never downloading).
  const [cachedModels, setCachedModels] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Bumped on each cache inspection so a late resolution for a superseded
  // inspection (model list/source change, or a load taking ownership) is
  // ignored.
  const cacheRevision = useRef(0);
  // Model ids the lifecycle has loaded this session. A successful load proves
  // the weights are cached, so these stay marked downloaded even when a cache
  // scan (which may have started before the load) resolves "not cached".
  const loadedModels = useRef<Set<string>>(new Set());
  const [source, setSource] = useState<"preset" | "webllm">(() =>
    stored(SOURCE_STORAGE, "preset") === "webllm" ? "webllm" : "preset",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [streaming, setStreaming] = useState(
    () => stored(STREAM_STORAGE, "true") !== "false",
  );

  // Terminate any worker/engine when the playground unmounts so a browser tab
  // close or navigation never leaks a live WebLLM engine. A rejected disposal
  // is swallowed — teardown has nowhere to surface it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadRevision.current += 1;
      void runtime.dispose().catch(() => undefined);
    };
  }, [runtime]);

  // Inspect WebLLM's browser cache for every selectable model whenever the
  // WebLLM model list is on screen. This only reads existing cache entries via
  // the injected checker; it never triggers a download or `runtime.load`. A
  // per-model rejection resolves as not cached, and a revision/mount guard
  // discards results from a superseded inspection.
  useEffect(() => {
    if (source !== "webllm" || !settingsOpen) return;
    const revision = ++cacheRevision.current;
    void Promise.all(
      modelRecords.map((record) =>
        modelCacheChecker(record.model_id).then(
          (cached) => (cached ? record.model_id : null),
          () => null,
        ),
      ),
    ).then((ids) => {
      if (!mounted.current || cacheRevision.current !== revision) return;
      // Merge, rather than replace, so a scan that resolves after (or races) a
      // successful load never drops a model the lifecycle just cached.
      setCachedModels(() => {
        const next = new Set(
          ids.filter((id): id is string => id !== null),
        );
        for (const id of loadedModels.current) next.add(id);
        return next;
      });
    });
  }, [source, settingsOpen, modelRecords, modelCacheChecker]);

  function persist(key: string, value: string) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  }

  /** Replace the live store with a fresh one seeded from `state` and remount
   *  the provider so the rendered UI reads the new state atomically. Used to
   *  seed a completed generation and to restore a rolled-back transaction. */
  function resetStateStore(state: Record<string, unknown>) {
    stateStoreRef.current = createStateStore(cloneState(state));
    setSpecVersion((version) => version + 1);
  }

  function handleSourceChange(value: string) {
    const next = value === "webllm" ? "webllm" : "preset";
    setSource(next);
    persist(SOURCE_STORAGE, next);
  }

  async function handleModelChange(value: WebLlmLoadableModelId) {
    if (value === model) return;
    // Changing models abandons any in-flight/ready engine and never downloads
    // the new one until the user explicitly loads it again.
    const revision = ++loadRevision.current;
    setModel(value);
    persist(MODEL_STORAGE, value);
    setModelLifecycle({ status: "idle" });
    try {
      await runtime.unload();
    } catch (error) {
      // Drop a late failure once the component unmounted or a newer lifecycle
      // superseded this unload, so it never overwrites current state.
      if (!mounted.current || loadRevision.current !== revision) return;
      const message = error instanceof Error ? error.message : String(error);
      setModelLifecycle({ status: "error", message });
    }
  }

  async function handleLoadModel() {
    const revision = ++loadRevision.current;
    // Supersede any in-flight cache inspection so its stale "not cached"
    // result can never overwrite the download this load is about to prove.
    cacheRevision.current += 1;
    setModelLifecycle({
      status: "loading",
      progress: 0,
      text: "Starting model load",
    });
    try {
      await runtime.load(model, (report: WebLlmProgress) => {
        if (!mounted.current || loadRevision.current !== revision) return;
        setModelLifecycle({
          status: "loading",
          progress: Math.min(1, Math.max(0, report.progress)),
          text: report.text,
        });
      });
      if (mounted.current && loadRevision.current === revision) {
        setModelLifecycle({ status: "ready" });
        // A successful load guarantees the weights are now cached; record and
        // reflect it immediately without re-inspecting the cache. Recording it
        // keeps a later cache scan from dropping it (see the inspection effect).
        loadedModels.current.add(model);
        setCachedModels((prev) => {
          if (prev.has(model)) return prev;
          const next = new Set(prev);
          next.add(model);
          return next;
        });
      }
    } catch (error) {
      if (!mounted.current || loadRevision.current !== revision) return;
      const message = error instanceof Error ? error.message : String(error);
      setModelLifecycle({ status: "error", message });
    }
  }

  const selectedModel = webLlmModelInfo(model);
  const canGenerate = source === "preset" || modelLifecycle.status === "ready";

  async function handleSubmit(value: string) {
    const text = value.trim();
    if (!text || busy || !canGenerate) return;

    const base = Date.now();
    // Snapshot the exact spec visible before this request so a failure can
    // restore it verbatim, discarding any partial progressive updates.
    const baseSpec = spec;
    // Snapshot the live state (including the user's in-progress edits) so a
    // failure restores it, discarding any conflicting streamed `/state` values.
    const stateSnapshot = cloneState(activeStore().getSnapshot());
    // Capture the load lifecycle generation so a late failure never overwrites
    // a lifecycle that a newer load/model-change has since produced.
    const revision = loadRevision.current;
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: base, role: "user", text, time: now() },
    ]);
    setBusy(true);
    setStreamLines([]);
    setView("preview");

    try {
      const result = await generate(
        text,
        {
          source,
          stream: streaming,
          engine: source === "webllm" ? runtime.current() : null,
        },
        baseSpec,
        {
          onSpec: (partial) => setSpec(partial),
          onLines: (newLines) =>
            setStreamLines((prev) => [...prev, ...newLines]),
          onPrompts: (next) => setPrompts(next),
        },
      );
      setSpec(result.spec);
      // Seed a fresh store from the finished document's (now complete)
      // `spec.state` — the `/state` patches stream in last — and remount.
      resetStateStore(specState(result.spec));
      const footer =
        source === "preset" ? "Preset" : `WebLLM · ${selectedModel.label}`;
      setMessages((prev) => [
        ...prev,
        {
          id: base + 1,
          role: "assistant",
          time: now(),
          footer,
          spec: result.spec,
          text:
            result.mode === "live"
              ? "Here's your UI — see the Preview."
              : (result.reason ?? "Rendered a UI — see the Preview."),
        },
      ]);
    } catch (error) {
      // Submission is transactional: drop every partial onSpec/onLines from this
      // request, restore the pre-request spec, and restore the state snapshot so
      // the user's live edits survive and conflicting streamed state is dropped.
      setSpec(baseSpec);
      setStreamLines([]);
      resetStateStore(stateSnapshot);
      if (source === "webllm") {
        const failure =
          error instanceof WebLlmError
            ? error
            : new WebLlmError(
                "inference-failed",
                `WebLLM generation failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
                { cause: error },
              );
        // Tear down the possibly-wedged engine so generation is disabled until
        // the user reloads. A rejected unload must not mask the inference error.
        try {
          await runtime.unload();
        } catch {
          // The visible inference error stays primary; Retry rebuilds the engine.
        }
        if (mounted.current && loadRevision.current === revision) {
          setModelLifecycle({ status: "error", message: failure.message });
        }
        if (mounted.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: base + 1,
              role: "assistant",
              time: now(),
              footer: `WebLLM · ${selectedModel.label}`,
              text: failure.message,
            },
          ]);
        }
      } else if (mounted.current) {
        // Preset renders a pure sample and should not fail; if it somehow does,
        // surface it plainly — no WebLLM footer and no lifecycle change.
        const message = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          { id: base + 1, role: "assistant", time: now(), text: message },
        ]);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function handleNewConversation() {
    if (busy) return;
    setMessages([]);
    setSpec(null);
    setStreamLines([]);
    setPrompts(null);
    setInput("");
    setView("preview");
    // Start the next generation from a clean state slate.
    resetStateStore({});
  }

  function renderMessage(message: Message) {
    if (message.role === "user") {
      return (
        <ChatMessage key={message.id} sender="user">
          <ChatMessageBubble
            variant="filled"
            metadata={<ChatMessageMetadata timestamp={message.time} />}
          >
            {message.text}
          </ChatMessageBubble>
        </ChatMessage>
      );
    }
    return (
      <ChatMessage
        key={message.id}
        sender="assistant"
        avatar={<Avatar name="Astryx" size="sm" />}
      >
        <ChatMessageBubble
          variant="ghost"
          name="Astryx"
          metadata={
            <ChatMessageMetadata timestamp={message.time} footer={message.footer} />
          }
        >
          {message.text}
        </ChatMessageBubble>
      </ChatMessage>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><code>json-render-astryx</code> Playground</div>
        <div className="topbar-right">
          <DropdownMenu
            placement="below"
            alignment="end"
            menuWidth={288}
            isMenuOpen={settingsOpen}
            onOpenChange={setSettingsOpen}
            button={{
              label: "Settings",
              icon: <Icon icon={Cog6ToothIcon} size="sm" />,
              variant: "ghost",
              size: "sm",
            }}
          >
            <div
              className="settings-menu"
              onKeyDown={(event) => event.stopPropagation()}
            >
              <div className="settings-row">
                <Text weight="medium">Generation source</Text>
                <SegmentedControl
                  value={source}
                  onChange={handleSourceChange}
                  label="Generation source"
                  size="sm"
                >
                  <SegmentedControlItem value="preset" label="Preset" />
                  <SegmentedControlItem value="webllm" label="WebLLM" />
                </SegmentedControl>
                <Text color="secondary" size="sm">
                  {source === "webllm"
                    ? "Run a prebuilt model in this browser with WebGPU. Loading starts only when you choose Load model."
                    : "Render built-in sample UIs — no model required."}
                </Text>
              </div>

              {source === "webllm" && (
                <div className="settings-row model-settings">
                  <span className="field-label">Model</span>
                  <div
                    className="model-list"
                    role="listbox"
                    aria-label="WebLLM model"
                  >
                    {modelRecords.map((record) => {
                      const isSelected = record.model_id === model;
                      const isCached = cachedModels.has(record.model_id);
                      return (
                        <button
                          key={record.model_id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className="model-option"
                          disabled={
                            modelLifecycle.status === "loading" || busy
                          }
                          onClick={() =>
                            void handleModelChange(record.model_id)
                          }
                        >
                          <span className="model-option-check" aria-hidden="true">
                            {isSelected && <Icon icon="check" size="sm" />}
                          </span>
                          <span className="model-option-id">
                            {record.model_id}
                          </span>
                          {isCached && (
                            <span
                              className="model-option-cached"
                              aria-label="Downloaded"
                              title="Downloaded"
                            >
                              <Icon icon={ArrowDownTrayIcon} size="sm" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <Text size="sm" weight="medium">
                    {selectedModel.memory}
                  </Text>
                  <Text size="sm" color="secondary">
                    {selectedModel.note}
                  </Text>

                  {modelLifecycle.status === "loading" && (
                    <div className="model-status" role="status">
                      <progress value={modelLifecycle.progress} max={1} />
                      <Text size="sm">{modelLifecycle.text}</Text>
                    </div>
                  )}
                  {modelLifecycle.status === "ready" && (
                    <Text size="sm" weight="medium">
                      Model ready
                    </Text>
                  )}
                  {modelLifecycle.status === "error" && (
                    <div className="settings-alert" role="alert">
                      <Text size="sm">{modelLifecycle.message}</Text>
                      <div className="model-actions">
                        <Button
                          label="Retry"
                          size="sm"
                          onClick={() => void handleLoadModel()}
                        />
                        <Button
                          label="Use Preset"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSourceChange("preset")}
                        />
                      </div>
                    </div>
                  )}
                  {modelLifecycle.status === "idle" && (
                    <Button
                      label="Load model"
                      size="sm"
                      onClick={() => void handleLoadModel()}
                    />
                  )}
                </div>
              )}
            </div>
          </DropdownMenu>
        </div>
      </header>

      <main className="panes">
        <section className="chat">
          <div className="chat-header">
            <Button
              label="New Conversation"
              variant="secondary"
              size="sm"
              onClick={handleNewConversation}
              isDisabled={busy}
            />
          </div>
          <ChatLayout
            density="compact"
            composer={
              <ChatComposer
                value={input}
                onChange={setInput}
                onSubmit={handleSubmit}
                placeholder="Describe a UI…"
                isDisabled={busy || !canGenerate}
                footerActions={
                  source === "webllm" &&
                  modelLifecycle.status === "ready" ? (
                    <>
                      <DropdownMenu
                        hasChevron
                        button={{
                          label: streaming ? "Streaming" : "Static",
                          icon: (
                            <Icon
                              icon={streaming ? BoltIcon : BoltSlashIcon}
                              size="sm"
                            />
                          ),
                          variant: "ghost",
                          size: "md",
                          isDisabled: busy,
                        }}
                        items={[
                          {
                            label: "Streaming",
                            icon: streaming ? <Icon icon="check" /> : undefined,
                            onClick: () => {
                              setStreaming(true);
                              persist(STREAM_STORAGE, "true");
                            },
                          },
                          {
                            label: "Static",
                            icon: !streaming ? <Icon icon="check" /> : undefined,
                            onClick: () => {
                              setStreaming(false);
                              persist(STREAM_STORAGE, "false");
                            },
                          },
                        ]}
                      />
                      <span className="model-chip">
                        <Icon icon={SparklesIcon} size="sm" />
                        {selectedModel.label}
                      </span>
                    </>
                  ) : undefined
                }
              />
            }
          >
            {messages.length === 0 && !busy ? (
              <div className="empty-hero">
                <span className="empty-hero-badge">
                  <Icon icon="info" size="lg" color="accent" />
                </span>
                <Heading level={3}>Generate a UI</Heading>
                <Text color="secondary">
                  Describe an interface and I'll build it live with Astryx
                  components. Try one of these:
                </Text>
                <div className="suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="suggestion"
                      disabled={busy || !canGenerate}
                      onClick={() => handleSubmit(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ChatMessageList isStreaming={busy}>
                {messages.map(renderMessage)}
                {busy && (
                  <ChatMessage
                    sender="assistant"
                    avatar={<Avatar name="Astryx" size="sm" />}
                  >
                    <ChatMessageBubble variant="ghost">
                      <span className="thinking">
                        <Spinner size="sm" /> Generating UI…
                      </span>
                    </ChatMessageBubble>
                  </ChatMessage>
                )}
              </ChatMessageList>
            )}
          </ChatLayout>
        </section>

        <section className="output">
          <div className="output-toolbar">
            <SegmentedControl
              value={view === "guide" ? "" : view}
              onChange={setView}
              label="Output view"
              size="sm"
            >
              <SegmentedControlItem value="preview" label="Preview" />
              <SegmentedControlItem value="code" label="Code" />
            </SegmentedControl>
            <Button
              label="Getting Started"
              size="sm"
              variant={view === "guide" ? "primary" : "secondary"}
              onClick={() => setView(view === "guide" ? "preview" : "guide")}
            />
          </div>

          <div className="output-body">
            {view === "guide" ? (
              <GettingStartedPane />
            ) : view === "code" ? (
              <SpecPane spec={spec} lines={streamLines} prompts={prompts} />
            ) : spec ? (
              <StateProvider key={specVersion} store={activeStore()}>
                <ActionProvider handlers={{}}>
                  <VisibilityProvider>
                    <Renderer spec={spec} registry={registry} loading={busy} />
                  </VisibilityProvider>
                </ActionProvider>
              </StateProvider>
            ) : (
              <div className="output-empty">
                Your generated UI will appear here.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
