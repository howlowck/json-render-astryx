import type { Spec } from "@json-render/react";

const defaultSpec: Spec = {
  root: "stack",
  elements: {
    stack: {
      type: "Stack",
      props: { direction: "vertical", gap: 4 },
      children: ["title", "desc", "cta"],
    },
    title: {
      type: "Heading",
      props: { level: 2, text: "json-render × Astryx" },
      children: [],
    },
    desc: {
      type: "Text",
      props: {
        text: "Try: “a signup form”, “a revenue dashboard”, or “a user profile card”.",
      },
      children: [],
    },
    cta: {
      type: "Button",
      props: { label: "Get started", variant: "primary" },
      children: [],
    },
  },
};

const signupSpec: Spec = {
  root: "card",
  elements: {
    card: { type: "Card", props: {}, children: ["stack"] },
    stack: {
      type: "Stack",
      props: { direction: "vertical", gap: 4 },
      children: ["title", "name", "email", "terms", "submit"],
    },
    title: {
      type: "Heading",
      props: { level: 3, text: "Create your account" },
      children: [],
    },
    name: {
      type: "TextInput",
      props: { label: "Full name", value: "" },
      children: [],
    },
    email: {
      type: "TextInput",
      props: { label: "Email", value: "" },
      children: [],
    },
    terms: {
      type: "Checkbox",
      props: { label: "I agree to the terms", value: false },
      children: [],
    },
    submit: {
      type: "Button",
      props: { label: "Sign up", variant: "primary" },
      children: [],
    },
  },
};

const dashboardSpec: Spec = {
  root: "stack",
  elements: {
    stack: {
      type: "Stack",
      props: { direction: "vertical", gap: 5 },
      children: ["title", "grid", "table"],
    },
    title: {
      type: "Heading",
      props: { level: 2, text: "Revenue Dashboard" },
      children: [],
    },
    grid: {
      type: "Grid",
      props: { columns: 3, gap: 4 },
      children: ["c1", "c2", "c3"],
    },
    c1: { type: "Card", props: {}, children: ["c1h", "c1v"] },
    c1h: { type: "Text", props: { text: "Total Revenue" }, children: [] },
    c1v: { type: "Heading", props: { level: 3, text: "$125,000" }, children: [] },
    c2: { type: "Card", props: {}, children: ["c2h", "c2v"] },
    c2h: { type: "Text", props: { text: "New Customers" }, children: [] },
    c2v: { type: "Heading", props: { level: 3, text: "1,204" }, children: [] },
    c3: { type: "Card", props: {}, children: ["c3h", "c3v"] },
    c3h: { type: "Text", props: { text: "Churn" }, children: [] },
    c3v: { type: "Heading", props: { level: 3, text: "2.1%" }, children: [] },
    table: {
      type: "Table",
      props: {
        columns: [
          { key: "region", header: "Region" },
          { key: "sales", header: "Sales" },
        ],
        rows: [
          { region: "US", sales: "$45,000" },
          { region: "EU", sales: "$35,000" },
          { region: "APAC", sales: "$20,000" },
        ],
      },
      children: [],
    },
  },
};

const profileSpec: Spec = {
  root: "card",
  elements: {
    card: { type: "Card", props: {}, children: ["row"] },
    row: {
      type: "Stack",
      props: { direction: "horizontal", gap: 4 },
      children: ["avatar", "info"],
    },
    avatar: {
      type: "Avatar",
      props: { name: "Ada Lovelace", size: "lg" },
      children: [],
    },
    info: {
      type: "Stack",
      props: { direction: "vertical", gap: 2 },
      children: ["name", "role", "badge"],
    },
    name: {
      type: "Heading",
      props: { level: 3, text: "Ada Lovelace" },
      children: [],
    },
    role: {
      type: "Text",
      props: { text: "Principal Engineer" },
      children: [],
    },
    badge: { type: "Badge", props: { label: "Pro" }, children: [] },
  },
};

/**
 * Deterministic prompt → spec mapping used when the live model is disabled.
 * Unknown prompts resolve to a welcome spec so the render pipeline always runs.
 */
export function matchMockSpec(prompt: string): Spec {
  const p = prompt.toLowerCase();
  if (/(sign\s?up|signup|form|login|register|contact)/.test(p)) return signupSpec;
  if (/(dashboard|revenue|metric|sales|analytic|report)/.test(p)) {
    return dashboardSpec;
  }
  if (/(profile|user|avatar|account|person)/.test(p)) return profileSpec;
  return defaultSpec;
}
