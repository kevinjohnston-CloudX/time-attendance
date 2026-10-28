import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// A pop up's backdrop drawn where its button lives is trapped in that spot's
// layer (a page's pinned bar is z-20, under the top bar's z-30), so the top bar
// shows through the dimmed page. <Overlay> draws it at the end of <body>.
const overlayMessage =
  "Draw pop up backdrops with <Overlay> from @/components/ui (it adds fixed inset-0 and portals to <body>). " +
  "A transparent click catcher for a dropdown must stay beside its menu: disable this line and say so.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/overlay.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "JSXAttribute[name.name='className'] Literal[value=/fixed inset-0/]", message: overlayMessage },
        { selector: "JSXAttribute[name.name='className'] TemplateElement[value.raw=/fixed inset-0/]", message: overlayMessage },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
