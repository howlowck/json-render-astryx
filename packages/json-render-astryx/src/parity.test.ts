import { describe, it, expect } from "vitest";
import { astryxComponentDefinitions } from "./catalog";
import { astryxComponents } from "./components";

/** Returns the keys present in `a` but missing from `b`. */
function difference(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((key) => !set.has(key));
}

describe("catalog/registry parity", () => {
  const definitionKeys = Object.keys(astryxComponentDefinitions).sort();
  const componentKeys = Object.keys(astryxComponents).sort();

  it("has a registry implementation for every catalog definition and vice versa", () => {
    const missingFromRegistry = difference(definitionKeys, componentKeys);
    const missingFromCatalog = difference(componentKeys, definitionKeys);
    expect(
      { missingFromRegistry, missingFromCatalog },
      "catalog and registry keys must match exactly",
    ).toEqual({ missingFromRegistry: [], missingFromCatalog: [] });
  });

  it("exposes exactly 18 components on both maps", () => {
    expect(definitionKeys).toHaveLength(18);
    expect(componentKeys).toHaveLength(18);
  });

  it("detects both missing and extra keys (guards the parity helper)", () => {
    expect(difference(["A", "B"], ["A"])).toEqual(["B"]);
    expect(difference(["A"], ["A", "B"])).toEqual([]);
  });
});
