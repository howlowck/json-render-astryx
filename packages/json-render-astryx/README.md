# json-render-astryx

Generative UI bindings that render [`json-render`](https://github.com/vercel-labs/json-render) specs with [Astryx](https://github.com/facebook/astryx) React components.

[Try the live playground](https://howlowck.github.io/json-render-astryx/).

## Install

Install the package and its required peers in your application:

```bash
npm install json-render-astryx @astryxdesign/core @json-render/core @json-render/react @stylexjs/stylex react react-dom zod
```

### Peer dependencies

| Package | Declared peer range |
| --- | --- |
| `@astryxdesign/core` | `^0.3.0` |
| `@json-render/core` | `^0.19.0` |
| `@json-render/react` | `^0.19.0` |
| `@stylexjs/stylex` | `^0.19.0` |
| `react` | `>=19.0.0` |
| `react-dom` | `>=19.0.0` |
| `zod` | `^4.0.0` |

Consumers must satisfy the intersection of all installed packages' peer
requirements. For example, `@json-render/react@0.19.0` requires React
`^19.2.3`, with a compatible React DOM version.

npm may show **0 Dependencies** for this package because that count reflects regular `dependencies`, not the package's peer dependency contract. These integrations intentionally remain peers so your application and `json-render-astryx` share the same React, json-render, Astryx, StyleX, and Zod instances.

## Theme CSS

Import the Astryx reset and base theme once at your application entry point:

```ts
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
```

The live playground also uses the optional neutral theme. Install and import it only if you want that appearance:

```bash
npm install @astryxdesign/theme-neutral
```

```ts
import "@astryxdesign/theme-neutral/theme.css";
```

`@astryxdesign/theme-neutral` is optional styling for this example, not a peer dependency of `json-render-astryx`.

## Create the catalog and registry

```tsx
import { defineCatalog } from "@json-render/core";
import { defineRegistry } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { astryxComponentDefinitions } from "json-render-astryx/catalog";
import { astryxComponents } from "json-render-astryx";

// Zod-only component definitions are safe to use for model guardrails on the server.
export const catalog = defineCatalog(schema, {
  components: astryxComponentDefinitions,
  actions: {},
});

// React implementations render specs in the application.
export const { registry } = defineRegistry(catalog, {
  components: astryxComponents,
});
```

## Render a spec

```tsx
import {
  ActionProvider,
  Renderer,
  StateProvider,
  VisibilityProvider,
  type Spec,
} from "@json-render/react";
import { registry } from "./registry";

export function GeneratedUI({ spec }: { spec: Spec }) {
  return (
    <StateProvider
      initialState={(spec as { state?: Record<string, unknown> }).state ?? {}}
    >
      <ActionProvider handlers={{}}>
        <VisibilityProvider>
          <Renderer spec={spec} registry={registry} />
        </VisibilityProvider>
      </ActionProvider>
    </StateProvider>
  );
}
```

## Public exports

| Import | Exports |
| --- | --- |
| `json-render-astryx` | `astryxComponents`, the React implementation map used by `defineRegistry` |
| `json-render-astryx/catalog` | `astryxComponentDefinitions`, `AstryxComponentDefinition`, and `AstryxComponentName`, the Zod-backed catalog surface |

## License

[MIT](https://github.com/howlowck/json-render-astryx/blob/main/LICENSE)
