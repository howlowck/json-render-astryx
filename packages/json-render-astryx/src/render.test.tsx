import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { defineCatalog } from "@json-render/core";
import type { Spec } from "@json-render/react";
import {
  ActionProvider,
  Renderer,
  StateProvider,
  VisibilityProvider,
  defineRegistry,
} from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { astryxComponentDefinitions } from "./catalog";
import { astryxComponents } from "./components";

afterEach(cleanup);

const catalog = defineCatalog(schema, {
  components: astryxComponentDefinitions,
  actions: {},
});

const { registry } = defineRegistry(catalog, {
  components: astryxComponents,
});

const nestedSpec: Spec = {
  root: "stack",
  elements: {
    stack: {
      type: "Stack",
      props: { direction: "vertical", gap: 4 },
      children: ["card"],
    },
    card: {
      type: "Card",
      props: {},
      children: ["heading", "text", "button", "input"],
    },
    heading: {
      type: "Heading",
      props: { level: 2, text: "Revenue Dashboard" },
      children: [],
    },
    text: {
      type: "Text",
      props: { text: "Quarterly performance summary" },
      children: [],
    },
    button: {
      type: "Button",
      props: { label: "Export", variant: "primary" },
      children: [],
    },
    input: {
      type: "TextInput",
      props: { label: "Search", value: "widgets" },
      children: [],
    },
  },
};

function renderSpec(spec: Spec) {
  return render(
    <StateProvider initialState={{}}>
      <ActionProvider handlers={{}}>
        <VisibilityProvider>
          <Renderer spec={spec} registry={registry} />
        </VisibilityProvider>
      </ActionProvider>
    </StateProvider>,
  );
}

describe("Renderer with the Astryx registry", () => {
  it("renders a nested spec through real Astryx components", () => {
    renderSpec(nestedSpec);

    expect(screen.getByText("Revenue Dashboard")).toBeTruthy();
    expect(screen.getByText("Quarterly performance summary")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Export/i }),
    ).toBeTruthy();

    const input = screen.getByLabelText("Search") as HTMLInputElement;
    expect(input.value).toBe("widgets");
  });

  it("does not render arbitrary DOM for an unregistered component type", () => {
    const spec: Spec = {
      root: "unknown",
      elements: {
        unknown: {
          type: "NotRegistered",
          props: {},
          children: [],
        },
      },
    };

    // Should not throw and should not render a "NotRegistered" element.
    renderSpec(spec);
    expect(screen.queryByText("NotRegistered")).toBeNull();
  });
});
