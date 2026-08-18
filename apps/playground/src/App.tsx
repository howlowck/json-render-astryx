import { useEffect, useState } from "react";
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
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Code } from "@astryxdesign/core/Code";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import {
  ActionProvider,
  Renderer,
  StateProvider,
  VisibilityProvider,
  type Spec,
} from "@json-render/react";
import { SparklesIcon, Cog6ToothIcon, BoltIcon, BoltSlashIcon } from "@heroicons/react/24/outline";
import { registry } from "./registry";
import { checkOllama, streamSpec, isModelInstalled } from "./generate";
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

const MODEL_STORAGE = "astryx-playground-ollama-model";
const PORT_STORAGE = "astryx-playground-ollama-port";
const SOURCE_STORAGE = "astryx-playground-source";
const STREAM_STORAGE = "astryx-playground-stream";
const DEFAULT_MODEL = "Select a model…";
const DEFAULT_PORT = "11434";
const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

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

function now(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [spec, setSpec] = useState<Spec | null>(null);
  const [specVersion, setSpecVersion] = useState(0);
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("preview");
  const [model, setModel] = useState(() =>
    stored(MODEL_STORAGE, import.meta.env.VITE_OLLAMA_MODEL ?? DEFAULT_MODEL),
  );
  const [port, setPort] = useState(() =>
    stored(PORT_STORAGE, import.meta.env.VITE_OLLAMA_PORT ?? DEFAULT_PORT),
  );
  const [health, setHealth] = useState<
    "checking" | "online" | "model-missing" | "offline"
  >("checking");
  const [models, setModels] = useState<string[]>([]);
  const [source, setSource] = useState<"preset" | "ollama">(() => {
    const saved = stored(SOURCE_STORAGE, "");
    return saved === "ollama" || saved === "preset" ? saved : "preset";
  });
  // While true, the source follows Ollama availability (auto-enable). A manual
  // toggle turns this off so the user's explicit choice always wins.
  const [sourceAuto, setSourceAuto] = useState(() => !stored(SOURCE_STORAGE, ""));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [troubleshootOpen, setTroubleshootOpen] = useState(false);
  const [streaming, setStreaming] = useState(
    () => stored(STREAM_STORAGE, "true") !== "false",
  );

  // Probe Ollama on load and whenever the port or model changes (debounced).
  useEffect(() => {
    let cancelled = false;
    setHealth("checking");
    const timer = setTimeout(() => {
      void checkOllama(port.trim() || DEFAULT_PORT).then((status) => {
        if (cancelled) return;
        setModels(status.reachable ? status.chatModels : []);
        if (!status.reachable) {
          setHealth("offline");
        } else if (isModelInstalled(status.models, model.trim() || DEFAULT_MODEL)) {
          setHealth("online");
        } else {
          setHealth("model-missing");
        }
        // Auto-enable Ollama when it's reachable, until the user makes an
        // explicit choice in Settings. Only ever turns Ollama *on* — if it
        // later goes unreachable we stay in Ollama mode and surface the
        // Troubleshoot flow instead of silently falling back to Preset.
        if (sourceAuto && status.reachable) {
          setSource("ollama");
        }
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [port, model, sourceAuto]);

  function persist(key: string, value: string) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  }

  function handleSourceChange(value: string) {
    const next = value === "ollama" ? "ollama" : "preset";
    setSource(next);
    setSourceAuto(false);
    persist(SOURCE_STORAGE, next);
  }

  async function handleSubmit(value: string) {
    const text = value.trim();
    if (!text || busy) return;

    const base = Date.now();
    const modelUsed = model.trim() || DEFAULT_MODEL;
    const baseSpec = spec;
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: base, role: "user", text, time: now() },
    ]);
    setBusy(true);
    setStreamLines([]);
    setView("preview");

    const { spec: next, mode, reason } = await streamSpec(
      text,
      {
        model: modelUsed,
        port: port.trim() || DEFAULT_PORT,
        source,
        stream: streaming,
      },
      baseSpec,
      {
        onSpec: (partial) => setSpec(partial),
        onLines: (newLines) =>
          setStreamLines((prev) => [...prev, ...newLines]),
      },
    );
    setSpec(next);
    // Remount so the finished document seeds the state store from its (now
    // complete) `spec.state` — the `/state` patches stream in last.
    setSpecVersion((version) => version + 1);
    const footer =
      source === "preset"
        ? "Preset"
        : mode === "live"
          ? `Ollama · ${modelUsed}`
          : "mock spec";
    setMessages((prev) => [
      ...prev,
      {
        id: base + 1,
        role: "assistant",
        time: now(),
        footer,
        spec: next,
        text:
          mode === "live"
            ? "Here's your UI — see the Preview."
            : (reason ?? "Rendered a UI — see the Preview."),
      },
    ]);
    setBusy(false);
  }

  function handleNewConversation() {
    if (busy) return;
    setMessages([]);
    setSpec(null);
    setStreamLines([]);
    setInput("");
    setView("preview");
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

  const statusLabel =
    health === "checking"
      ? "Checking Ollama…"
      : health === "online"
        ? "Ollama online"
        : health === "model-missing"
          ? "Model not installed"
          : "Ollama offline";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><code>json-render-astryx</code> Playground</div>
        <div className="topbar-right">
          {source === "ollama" && (
            <span className={`status status--${health}`} role="status">
              <span className="status-dot" aria-hidden="true" />
              {statusLabel}
            </span>
          )}

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
                  <SegmentedControlItem value="ollama" label="Ollama" />
                </SegmentedControl>
                <Text color="secondary" size="sm">
                  {source === "ollama"
                    ? "Stream live UIs from your local Ollama server."
                    : "Render built-in sample UIs — no model required."}
                </Text>
              </div>

              {source === "ollama" && (
                <div className="settings-row">
                  <label className="field">
                    <span className="field-label">Ollama port</span>
                    <input
                      className="field-input field-input--port"
                      value={port}
                      onChange={(event) => {
                        setPort(event.target.value);
                        persist(PORT_STORAGE, event.target.value);
                      }}
                      placeholder={DEFAULT_PORT}
                      inputMode="numeric"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>

                  {health === "offline" && (
                    <div className="settings-alert">
                      <Text color="secondary" size="sm">
                        Ollama isn't reachable on port {port.trim() || DEFAULT_PORT}.
                      </Text>
                      <Button
                        label="Troubleshoot"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSettingsOpen(false);
                          setTroubleshootOpen(true);
                        }}
                      />
                    </div>
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
                isDisabled={busy}
                footerActions={
                  source === "ollama" ? (
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
                      <DropdownMenu
                        hasChevron
                        button={{
                          label: model.trim() || DEFAULT_MODEL,
                          icon: <Icon icon={SparklesIcon} size="sm" />,
                          variant: "ghost",
                          size: "md",
                          isDisabled: busy
                        }}
                        items={
                          models.length > 0
                            ? models.map((name) => ({
                                label: name,
                                icon:
                                  name === model ? (
                                    <Icon icon="check" />
                                  ) : undefined,
                                onClick: () => {
                                  setModel(name);
                                  persist(MODEL_STORAGE, name);
                                },
                              }))
                            : [{ label: "No models found", isDisabled: true }]
                        }
                      />
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
              <SpecPane spec={spec} lines={streamLines} />
            ) : spec ? (
              <StateProvider
                key={specVersion}
                initialState={
                  (spec as { state?: Record<string, unknown> }).state ?? {}
                }
              >
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

      <Dialog
        isOpen={troubleshootOpen}
        onOpenChange={setTroubleshootOpen}
        width={480}
        purpose="info"
      >
        <Layout
          header={
            <DialogHeader
              title="Troubleshoot Ollama"
              subtitle="Get a local model running, then come back."
              onOpenChange={setTroubleshootOpen}
            />
          }
          content={
            <LayoutContent>
              <ol className="dialog-steps">
                <li>
                  <Text weight="medium">Install Ollama</Text>
                  <Text color="secondary" size="sm">
                    Download and install it from{" "}
                    <Link href={OLLAMA_DOWNLOAD_URL} target="_blank">
                      ollama.com/download
                    </Link>
                    , then launch the app.
                  </Text>
                </li>
                <li>
                  <Text weight="medium">Download a chat model</Text>
                  <Text color="secondary" size="sm">
                    In a terminal, pull a chat-completion model, for example{" "}
                    <Code>ollama pull llama3.2</Code>.
                  </Text>
                </li>
                <li>
                  <Text weight="medium">Refresh this page</Text>
                  <Text color="secondary" size="sm">
                    Once Ollama is running with a model, reload to reconnect.
                  </Text>
                </li>
              </ol>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <div className="dialog-actions">
                <Button
                  label="Close"
                  variant="secondary"
                  onClick={() => setTroubleshootOpen(false)}
                />
                <Button
                  label="Refresh this page"
                  variant="primary"
                  onClick={() => window.location.reload()}
                />
              </div>
            </LayoutFooter>
          }
        />
      </Dialog>
    </div>
  );
}
