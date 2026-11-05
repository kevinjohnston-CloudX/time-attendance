import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// The repo's tsconfig keeps JSX as is for Next, which a test cannot read, and
// the "@" folder alias is Next's own. Both are repeated here, for tests only.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // _ops/ holds one-off scripts and the security tests, which run only
  // against a local test database (_ops/sec/harness.ts refuses anything else).
  test: { exclude: [...configDefaults.exclude, "_ops/**"] },
});
