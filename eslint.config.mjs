import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// A pop up's backdrop drawn where its button lives is trapped in that spot's
// layer (a page's pinned bar is z-20, under the top bar's z-30), so the top bar
// shows through the dimmed page. <Overlay> draws it at the end of <body>.
const overlayMessage =
  "Draw pop up backdrops with <Overlay> from @/components/ui (it adds fixed inset-0 and portals to <body>). " +
  "A transparent click catcher for a dropdown must stay beside its menu: disable this line and say so.";

const overlaySelectors = [
  { selector: "JSXAttribute[name.name='className'] Literal[value=/fixed inset-0/]", message: overlayMessage },
  { selector: "JSXAttribute[name.name='className'] TemplateElement[value.raw=/fixed inset-0/]", message: overlayMessage },
];

// Anything drawn at the end of <body> (a dropdown's list, a calendar, a menu,
// a window) sits outside the panel that opened it, so a panel closing on "a
// press not inside me" closed on a press on it: picking a Timecards filter did
// nothing (ticket 79224). floating-layer.tsx holds the one way to do both.
const pressSelector = {
  selector: "CallExpression[callee.property.name='addEventListener'][arguments.0.value=/^(mousedown|pointerdown)$/]",
  message:
    "Close a panel on a press outside it with useOutsidePress from @/components/ui/floating-layer: " +
    "a hand-written listener takes a press on a dropdown's list, a calendar or a window for a press outside (ticket 79224).",
};
const portalMessage =
  "Draw at the end of <body> with floatingPortal from @/components/ui/floating-layer: it marks the layer, so " +
  "a press on it is never taken for a press outside the panel that opened it (ticket 79224).";

// Allowed their own press listeners: the shared pieces that implement the rule,
// tests that imitate a hand-written panel on purpose, and two Live Attendance
// files with another piece of work open in them (Nov 23), to move onto
// useOutsidePress when it lands. Their dropdowns and calendars are safe meanwhile:
// those keep every press on themselves (useOwnPresses).
const ownPressListeners = [
  "src/components/ui/floating-layer.tsx",
  "src/components/ui/select-lists.tsx",
  "src/components/ui/date-calendars.tsx",
  "src/**/*.test.{ts,tsx}",
  "src/components/presence/building-menu.tsx",
  "src/components/presence/on-site-board.tsx",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/overlay.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...overlaySelectors, pressSelector],
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "react-dom", importNames: ["createPortal"], message: portalMessage }] },
      ],
    },
  },
  {
    files: ownPressListeners,
    rules: { "no-restricted-syntax": ["error", ...overlaySelectors] },
  },
  {
    // The one place createPortal is called, and the building menu (see above).
    files: ["src/components/ui/floating-layer.tsx", "src/components/presence/building-menu.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The store app shell has its own packages and is not part of the site.
    "mobile-app/**",
  ]),
]);

export default eslintConfig;
