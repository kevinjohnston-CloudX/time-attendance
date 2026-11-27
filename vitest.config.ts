import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// The repo's tsconfig keeps JSX as is for Next, which a test cannot read, and
// the "@" folder alias is Next's own. Both are repeated here, for tests only.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // A server only file (the engine reads hours through one) is fine in a
      // test, which runs on the server: Next's own empty stand in, as its
      // server build uses.
      "server-only": path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
    },
  },
  // _ops/ holds one-off scripts and the security tests, which run only
  // against a local test database (_ops/sec/harness.ts refuses anything else).
  test: { exclude: [...configDefaults.exclude, "_ops/**"] },
});
