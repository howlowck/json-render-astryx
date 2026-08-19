import { defineCatalog } from "@json-render/core";
import { defineRegistry } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { astryxComponentDefinitions } from "json-render-astryx/catalog";
import { astryxComponents } from "json-render-astryx";
import content from "./system-instructions.md?raw";

export const catalog = defineCatalog(schema, {
  components: astryxComponentDefinitions,
  actions: {},
});

// Standalone streaming mode: the model emits JSONL RFC 6902 patch operations
// that the SpecStream compiler assembles into a spec. `catalog.prompt()` carries
// the full json-render protocol plus the live component schema; the custom rules
// pin the Astryx-specific conventions (literal props, text-in-props, root shape).
// export const systemPrompt = catalog.prompt({
//   system: "",
//   editModes: ["patch"],
//   customRules: [
//     "Do NOT use /state or $state/$template bindings.",
//     "The /root value MUST exactly equal the key of the top-level element you define in /elements.",
//     'Put literal values directly in props (e.g. "text": "Welcome", "label": "Buy"). Do NOT use /state or $state/$template bindings.',
//     "Text content goes in props: Heading and Text use `text`; Button and Badge use `label`; Link uses `text`.",
//     "Use Stack or Card as the root for forms and small UIs; use Grid for multi-column layouts.",
//     "Every element key you reference in a children array must have its own /elements/<key> patch, or it renders nothing.",
//   ],
// });

// We are going to use a custom system prompt that can fit in a smaller context window.
export const systemPrompt = content;

console.log(systemPrompt);

/** Registered components, surfaced in the playground's Catalog view. */
export const catalogComponents = Object.entries(astryxComponentDefinitions).map(
  ([name, def]) => ({
    name,
    description: def.description ?? "",
    isContainer: "slots" in def && Boolean(def.slots),
  }),
);

export const { registry } = defineRegistry(catalog, {
  components: astryxComponents,
});
