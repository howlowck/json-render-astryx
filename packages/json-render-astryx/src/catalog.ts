import { z } from "zod";

/**
 * A json-render catalog definition entry for an Astryx-bound component.
 * `props` is the Zod schema the AI must satisfy; `slots` marks container
 * components (`["default"]` = accepts children); `description` guides the model.
 */
export interface AstryxComponentDefinition {
  props: z.ZodType;
  slots?: string[];
  description: string;
}

/**
 * Catalog definitions for the curated Astryx component set. Zod-only and
 * React-free, so this module is safe to import in server-side prompt
 * generation. Pass individual entries to `defineCatalog`.
 */
export const astryxComponentDefinitions = {
  Stack: {
    props: z.object({
      direction: z.enum(["horizontal", "vertical"]).optional(),
      gap: z.number().optional(),
      padding: z.number().optional(),
    }),
    slots: ["default"],
    description:
      "Flex container that stacks children vertically (default) or horizontally with a gap.",
  },
  Grid: {
    props: z.object({
      columns: z.number().optional(),
      gap: z.number().optional(),
    }),
    slots: ["default"],
    description: "Responsive grid layout with a fixed number of columns.",
  },
  Section: {
    props: z.object({
      variant: z.enum(["section", "transparent", "muted"]).optional(),
      padding: z.number().optional(),
    }),
    slots: ["default"],
    description: "Padded content region with an optional surface variant.",
  },
  Divider: {
    props: z.object({
      orientation: z.enum(["horizontal", "vertical"]).optional(),
      label: z.string().optional(),
      variant: z.enum(["subtle", "strong"]).optional(),
    }),
    description: "Horizontal or vertical separator with an optional caption.",
  },
  Card: {
    props: z.object({
      variant: z.string().optional(),
      padding: z.number().optional(),
    }),
    slots: ["default"],
    description: "Elevated container card for grouping related content.",
  },
  Heading: {
    props: z.object({
      level: z.number().int().min(1).max(6),
      text: z.string(),
    }),
    description: "Section heading text at a given level (1-6).",
  },
  Text: {
    props: z.object({
      text: z.string(),
      size: z.string().optional(),
      weight: z.string().optional(),
    }),
    description: "Paragraph or inline body text.",
  },
  Badge: {
    props: z.object({
      label: z.string(),
      variant: z.string().optional(),
    }),
    description: "Small status label or tag.",
  },
  Button: {
    props: z.object({
      label: z.string(),
      variant: z.enum(["primary", "secondary", "ghost", "destructive"]).optional(),
      size: z.enum(["sm", "md", "lg"]).optional(),
    }),
    description:
      "Clickable button. Emits a 'press' event that maps to json-render actions.",
  },
  Link: {
    props: z.object({
      text: z.string(),
      href: z.string(),
    }),
    description: "Anchor link to a URL.",
  },
  TextInput: {
    props: z.object({
      label: z.string(),
      value: z.string().default(""),
      placeholder: z.string().optional(),
    }),
    description:
      "Single-line text field. Bind `value` to state with $bindState for two-way input.",
  },
  NumberInput: {
    props: z.object({
      label: z.string(),
      value: z.number().nullable().default(null),
    }),
    description:
      "Numeric field. Bind `value` to state with $bindState for two-way input.",
  },
  Checkbox: {
    props: z.object({
      label: z.string(),
      value: z.boolean().default(false),
    }),
    description:
      "Checkbox. Bind `value` to state with $bindState for two-way input.",
  },
  RadioList: {
    props: z.object({
      label: z.string(),
      value: z.string().default(""),
      options: z.array(z.object({ label: z.string(), value: z.string() })),
    }),
    description:
      "Single-choice radio group. Bind `value` to state with $bindState.",
  },
  Selector: {
    props: z.object({
      label: z.string(),
      value: z.string().default(""),
      options: z.array(z.object({ label: z.string(), value: z.string() })),
    }),
    description:
      "Dropdown selector. Bind `value` to state with $bindState.",
  },
  Switch: {
    props: z.object({
      label: z.string(),
      value: z.boolean().default(false),
    }),
    description:
      "On/off toggle. Bind `value` to state with $bindState for two-way input.",
  },
  Table: {
    props: z.object({
      columns: z.array(z.object({ key: z.string(), header: z.string() })),
      rows: z.array(z.record(z.string(), z.unknown())),
    }),
    description:
      "Data table. `columns` define keys/headers; each row is an object keyed by column key.",
  },
  Avatar: {
    props: z.object({
      name: z.string().optional(),
      src: z.string().optional(),
      size: z.string().optional(),
    }),
    description: "User avatar rendered from an image or initials.",
  },
} satisfies Record<string, AstryxComponentDefinition>;

export type AstryxComponentName = keyof typeof astryxComponentDefinitions;
