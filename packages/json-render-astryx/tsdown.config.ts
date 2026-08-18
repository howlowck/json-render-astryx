import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/catalog.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "react",
    "react-dom",
    "@json-render/core",
    "@json-render/react",
    "@stylexjs/stylex",
    "zod",
    "@astryxdesign/core",
    /^@astryxdesign\/core\//,
  ],
});
