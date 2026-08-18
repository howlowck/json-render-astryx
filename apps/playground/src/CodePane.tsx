import { useState } from "react";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Text } from "@astryxdesign/core/Text";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import type { Spec } from "@json-render/react";
import { catalogComponents } from "./registry";

const INSTALL = `npm install json-render-astryx @json-render/core @json-render/react \\
  @astryxdesign/core @stylexjs/stylex zod`;

const THEME = `// Import Astryx's theme once, at your app entry point.
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";`;

const SETUP = `import { defineCatalog } from "@json-render/core";
import { defineRegistry } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { astryxComponentDefinitions } from "json-render-astryx/catalog";
import { astryxComponents } from "json-render-astryx";

// Guardrails for the model (Zod-only, safe on the server too):
const catalog = defineCatalog(schema, {
  components: astryxComponentDefinitions,
  actions: {},
});

// React implementations that render the spec:
export const { registry } = defineRegistry(catalog, {
  components: astryxComponents,
});`;

const RENDER = `import {
  Renderer,
  StateProvider,
  ActionProvider,
  VisibilityProvider,
  type Spec,
} from "@json-render/react";
import { registry } from "./registry";

export function GeneratedUI({ spec }: { spec: Spec }) {
  return (
    <StateProvider initialState={{}}>
      <ActionProvider handlers={{}}>
        <VisibilityProvider>
          <Renderer spec={spec} registry={registry} />
        </VisibilityProvider>
      </ActionProvider>
    </StateProvider>
  );
}`;

/**
 * Step-by-step integration guide ("Getting Started") — how to wire
 * json-render-astryx into your own app.
 */
export function GettingStartedPane() {
  return (
    <div className="code-pane">
      <Text color="secondary">
        json-render-astryx turns a JSON spec into real Astryx components. This is
        the whole integration — copy it into your app to get started.
      </Text>

      <CodeBlock
        title="1 · Install"
        language="bash"
        code={INSTALL}
        hasCopyButton
        width="100%"
      />
      <CodeBlock
        title="2 · Import the theme"
        language="ts"
        code={THEME}
        hasCopyButton
        width="100%"
      />
      <CodeBlock
        title="3 · Build the catalog + registry"
        language="tsx"
        code={SETUP}
        hasCopyButton
        width="100%"
      />
      <CodeBlock
        title="4 · Render any spec"
        language="tsx"
        code={RENDER}
        hasCopyButton
        width="100%"
      />
    </div>
  );
}

/**
 * Behind-the-scenes view of the current generation with three sub-views:
 * - Spec: the compiled JSON spec being rendered in the Preview.
 * - Stream: the raw JSONL patch operations the model streamed (SpecStream).
 * - Catalog: the components registered with the renderer.
 */
export function SpecPane({
  spec,
  lines,
}: {
  spec: Spec | null;
  lines: string[];
}) {
  const [subView, setSubView] = useState("spec");

  const specJson = spec
    ? JSON.stringify(spec, null, 2)
    : "// Generate a UI in the chat to see the JSON spec the model produced.";

  const streamJsonl =
    lines.length > 0
      ? lines.join("\n")
      : "// SpecStream patch operations (JSONL) appear here as the model streams.";

  const catalogJson = JSON.stringify(
    catalogComponents.map(({ name, description, isContainer }) => ({
      name,
      container: isContainer,
      description,
    })),
    null,
    2,
  );

  return (
    <div className="code-pane">
      <div className="code-subtoggle">
        <SegmentedControl
          value={subView}
          onChange={setSubView}
          label="Code view"
          size="sm"
        >
          <SegmentedControlItem value="spec" label="Spec" />
          <SegmentedControlItem value="stream" label="Stream" />
          <SegmentedControlItem value="catalog" label="Catalog" />
        </SegmentedControl>
      </div>

      {subView === "spec" && (
        <CodeBlock
          title="Rendered spec"
          language="json"
          code={specJson}
          hasCopyButton
          width="100%"
        />
      )}
      {subView === "stream" && (
        <CodeBlock
          title="SpecStream — JSONL patches"
          language="json"
          code={streamJsonl}
          hasCopyButton
          width="100%"
        />
      )}
      {subView === "catalog" && (
        <CodeBlock
          title={`Registered components (${catalogComponents.length})`}
          language="json"
          code={catalogJson}
          hasCopyButton
          width="100%"
        />
      )}
    </div>
  );
}

