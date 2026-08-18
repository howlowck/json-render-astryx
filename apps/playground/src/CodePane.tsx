import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Text } from "@astryxdesign/core/Text";
import type { Spec } from "@json-render/react";

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

/** The live JSON spec currently rendered in the Preview pane. */
export function SpecPane({ spec }: { spec: Spec | null }) {
  const specJson = spec
    ? JSON.stringify(spec, null, 2)
    : "// Generate a UI in the chat to see the JSON spec the model produced.";

  return (
    <div className="code-pane">
      <CodeBlock
        title="Rendered spec"
        language="json"
        code={specJson}
        hasCopyButton
        width="100%"
      />
    </div>
  );
}

