import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  astryxComponentDefinitions,
  type AstryxComponentDefinition,
} from "./catalog";

const definitions: Record<string, AstryxComponentDefinition> =
  astryxComponentDefinitions;

const EXPECTED_KEYS = [
  "Stack",
  "Grid",
  "Section",
  "Divider",
  "Card",
  "Heading",
  "Text",
  "Badge",
  "Button",
  "Link",
  "TextInput",
  "NumberInput",
  "Checkbox",
  "RadioList",
  "Selector",
  "Switch",
  "Table",
  "Avatar",
];

const CONTAINER_KEYS = ["Stack", "Grid", "Section", "Card"];

describe("astryxComponentDefinitions", () => {
  it("exposes exactly the curated 18 components", () => {
    expect(Object.keys(astryxComponentDefinitions).sort()).toEqual(
      [...EXPECTED_KEYS].sort(),
    );
  });

  it("gives every entry a Zod props schema and a nonempty description", () => {
    for (const [name, def] of Object.entries(definitions)) {
      expect(def.props, `${name}.props`).toBeInstanceOf(z.ZodType);
      expect(def.description.trim().length, `${name}.description`).toBeGreaterThan(
        0,
      );
    }
  });

  it("marks only container components with slots ['default']", () => {
    for (const [name, def] of Object.entries(definitions)) {
      if (CONTAINER_KEYS.includes(name)) {
        expect(def.slots, `${name}.slots`).toEqual(["default"]);
      } else {
        expect(def.slots, `${name}.slots`).toBeUndefined();
      }
    }
  });

  it("accepts valid props and rejects invalid props", () => {
    expect(
      astryxComponentDefinitions.Heading.props.safeParse({
        level: 2,
        text: "Hi",
      }).success,
    ).toBe(true);
    // level out of range
    expect(
      astryxComponentDefinitions.Heading.props.safeParse({
        level: 7,
        text: "Hi",
      }).success,
    ).toBe(false);
    // unknown Button variant enum
    expect(
      astryxComponentDefinitions.Button.props.safeParse({
        label: "Go",
        variant: "huge",
      }).success,
    ).toBe(false);
    // TextInput value must be a string
    expect(
      astryxComponentDefinitions.TextInput.props.safeParse({
        label: "Name",
        value: 42,
      }).success,
    ).toBe(false);
  });
});
