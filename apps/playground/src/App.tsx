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
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
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
import { SparklesIcon } from "@heroicons/react/24/outline";
import { registry } from "./registry";
import { checkOllama, generateSpec, isModelInstalled } from "./generate";
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
const DEFAULT_MODEL = "Select a model…";
const DEFAULT_PORT = "11434";

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
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [port, model]);

  function persist(key: string, value: string) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  }

  async function handleSubmit(value: string) {
    const text = value.trim();
    if (!text || busy) return;

    const base = Date.now();
    const modelUsed = model.trim() || DEFAULT_MODEL;
    const history = messages.map((message) => ({
      role: message.role,
      content:
        message.role === "assistant" && message.spec
          ? JSON.stringify(message.spec)
          : message.text,
    }));
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: base, role: "user", text, time: now() },
    ]);
    setBusy(true);

    const { spec: next, mode, reason } = await generateSpec(
      text,
      {
        model: modelUsed,
        port: port.trim() || DEFAULT_PORT,
      },
      history,
    );
    setSpec(next);
    setSpecVersion((version) => version + 1);
    setView("preview");
    setMessages((prev) => [
      ...prev,
      {
        id: base + 1,
        role: "assistant",
        time: now(),
        footer: mode === "live" ? `Ollama · ${modelUsed}` : "mock spec",
        spec: next,
        text:
          mode === "live"
            ? "Here's your UI — see the Preview."
            : (reason ?? "Rendered a mock UI — see the Preview."),
      },
    ]);
    setBusy(false);
  }

  function handleNewConversation() {
    if (busy) return;
    setMessages([]);
    setSpec(null);
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
          <Popover
            placement="below"
            alignment="end"
            width={340}
            content={
              <div className="info-pop">
                <Text weight="medium">Local Ollama, in your browser</Text>
                <Text color="secondary">
                  Prompts are sent to your local Ollama server directly from the
                  browser — nothing leaves your machine. Ollama must be running
                  with the model pulled. If the browser is blocked by CORS, start
                  it with <Code>OLLAMA_ORIGINS=http://localhost:5173</Code>. When
                  Ollama is unreachable, the playground renders offline mock specs.
                </Text>
              </div>
            }
          >
            <IconButton
              icon={<Icon icon="info" />}
              label="About the Ollama connection"
              variant="ghost"
              size="sm"
            />
          </Popover>

          <span className={`status status--${health}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            {statusLabel}
          </span>

          <div className="controls">
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
          </div>
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
              <SpecPane spec={spec} />
            ) : spec ? (
              <StateProvider key={specVersion} initialState={{}}>
                <ActionProvider handlers={{}}>
                  <VisibilityProvider>
                    <Renderer spec={spec} registry={registry} />
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
