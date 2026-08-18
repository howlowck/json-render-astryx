import { defineCatalog } from "@json-render/core";
import { defineRegistry } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { astryxComponentDefinitions } from "json-render-astryx/catalog";
import { astryxComponents } from "json-render-astryx";

export const catalog = defineCatalog(schema, {
  components: astryxComponentDefinitions,
  actions: {},
});

// `catalog.prompt()`/`catalog.jsonSchema()` target json-render's internal
// binding-wrapped format (props like {value}, JSONL patch streaming). This
// playground's Astryx components render plain props, so we drive the model with
// a single-object prompt + a simple schema (below) instead.

export const rawPrompt = catalog.prompt();

const componentDocs = Object.entries(astryxComponentDefinitions)
  .map(([name, def]) => {
    const container = "slots" in def && def.slots ? " [container]" : "";
    return `- ${name}: ${def.description ?? ""}${container}`;
  })
  .join("\n");

const exampleSpec = {
  root: "root",
  elements: {
    root: { type: "Stack", props: { gap: 4 }, children: ["title", "body"] },
    title: { type: "Heading", props: { level: 2, text: "Hello" }, children: [] },
    body: {
      type: "Text",
      props: { text: "A short paragraph." },
      children: [],
    },
  },
};

export const systemPrompt = [
  "You generate UI as JSON for a constrained renderer. Output ONLY a single JSON object matching the schema — no prose, no patch operations.",
  'Format: {"root": "<key>", "elements": {"<key>": {"type": "<Component>", "props": {}, "children": ["<key>"]}}}',
  "Use ONLY these component types:",
  componentDocs,
  "CRITICAL: every key you list in a `children` array MUST have its own entry in `elements`. Never reference a child key you have not defined — an undefined child renders nothing.",
  "Container components [container] hold child element keys in `children`; leaf components use an empty array and carry their content in `props`.",
  "Text content goes in props: Heading/Text use `text`; Button/Badge use `label`; Link uses `text`.",
  "Earlier assistant turns are the JSON spec currently on screen. For a follow-up request, modify that spec and return the full updated JSON object.",
  "Complete example (note every child key is defined):",
  JSON.stringify(exampleSpec),
].join("\n");

export const jsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    root: { type: "string" },
    elements: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          props: { type: "object" },
          children: { type: "array", items: { type: "string" } },
        },
        required: ["type", "children"],
      },
    },
  },
  required: ["root", "elements"],
} as const;

export const { registry } = defineRegistry(catalog, {
  components: astryxComponents,
});
