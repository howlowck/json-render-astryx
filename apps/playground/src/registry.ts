import { defineCatalog } from "@json-render/core";
import { defineRegistry } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { astryxComponentDefinitions } from "json-render-astryx/catalog";
import { astryxComponents } from "json-render-astryx";

export const catalog = defineCatalog(schema, {
  components: astryxComponentDefinitions,
  actions: {},
});

// Standalone streaming mode: the model emits JSONL patch operations (RFC 6902)
// that the SpecStream compiler assembles into a spec. `catalog.prompt()`
// produces the matching system prompt; customRules tune it for the Astryx
// components this playground renders.
export const systemPrompt = catalog.prompt({
  // Document the "patch" edit mode so follow-up requests refine the current spec.
  editModes: ["patch"],
  customRules: [
    "The /root value MUST exactly equal the key of the top-level element you define in /elements.",
    "Put literal values directly in props (e.g. \"text\": \"Welcome\", \"label\": \"Buy\"). Do NOT use /state or $state/$template bindings.",
    "Text content goes in props: Heading and Text use `text`; Button and Badge use `label`; Link uses `text`.",
    "Use Stack or Card as the root for forms and small UIs; use Grid for multi-column layouts.",
    "Every element key you reference in a children array must have its own /elements/<key> patch, or it renders nothing.",
  ],
});

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
