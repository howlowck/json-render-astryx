import { defineConfig } from "vitest/config";

// React's CJS entry picks its dev/prod build from NODE_ENV. Only the dev build
// exposes React.act, which @testing-library/react needs to render.
process.env.NODE_ENV = "development";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
