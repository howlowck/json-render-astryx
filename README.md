# json-render-astryx

Generative UI bindings that render [`json-render`](https://github.com/vercel-labs/json-render) specifications with [Astryx](https://github.com/facebook/astryx) React components.

The package provides Zod-backed Astryx component definitions for a `json-render` catalog and React implementations for its renderer registry. The included playground demonstrates the complete flow from an LLM-generated patch stream to a rendered Astryx interface.

[Try the live playground](https://howlowck.github.io/json-render-astryx/) or read the [package documentation](packages/json-render-astryx/README.md).

## How it works

1. `json-render-astryx/catalog` supplies Astryx component schemas to the model-facing catalog.
2. An LLM produces newline-delimited RFC 6902 JSON Patch operations.
3. `json-render` compiles the patches into a UI specification.
4. `json-render-astryx` maps the specification to Astryx React components.

The adapter is independent of the model provider. The playground uses WebLLM to run supported models locally in the browser.

## Playground

The playground includes:

- Preset mode for trying the renderer without loading a model.
- Browser-local WebLLM inference in a dedicated worker.
- Explicit model loading, download progress, and cache indicators.
- Progressive streaming and static generation modes.
- Follow-up edits that preserve the current specification and form state.
- Preview and code views for the specification, raw patch stream, component catalog, and exact prompts sent to the model.

The WebLLM picker includes prebuilt `q4f16` text-generation models with declared context windows greater than 4,000 tokens. Model weights remain in the browser cache for the current origin.

## Workspace

This repository is a pnpm and Turborepo workspace.

| Path | Purpose |
| --- | --- |
| [`packages/json-render-astryx`](packages/json-render-astryx) | Published adapter package and canonical consumer documentation |
| [`apps/playground`](apps/playground) | React and Vite playground deployed to GitHub Pages |

## Development

### Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 22.18.0 |
| npm | 11.5.1 |
| pnpm | 10.23.0 |

Install dependencies and start the workspace:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open the playground URL printed by Vite, normally `http://localhost:5173/json-render-astryx/`.

### Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run workspace development tasks |
| `pnpm typecheck` | Type-check all workspace packages |
| `pnpm test` | Run all tests |
| `pnpm build` | Build the package and playground |
| `pnpm --filter playground dev` | Run only the playground development server |
| `pnpm --filter playground preview` | Preview the production playground build |

For package installation, peer dependencies, theme setup, API examples, and public exports, see the [package README](packages/json-render-astryx/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local validation and release procedures.

## License

[MIT](LICENSE)
