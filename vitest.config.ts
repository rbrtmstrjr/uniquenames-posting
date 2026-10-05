import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // Component tests (.tsx) opt into jsdom per file with `// @vitest-environment jsdom`.
  test: { environment: "node", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"], testTimeout: 30000 },
});
