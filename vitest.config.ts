import path from "node:path";
import { defineConfig } from "vitest/config";

// The repo's tsconfig keeps JSX as is for Next, which a test cannot read, and
// the "@" folder alias is Next's own. Both are repeated here, for tests only.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
