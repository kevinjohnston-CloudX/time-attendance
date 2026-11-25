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

// Building a date formatter loads its time zone and locale rules: a report
// that built one per line built 57,000 a run and ran past the live server's
// 5 minute limit (Nov 24, 2026). One built at the top of a file is built
// once and is fine; inside a function it is built on every call.
const formatterMessage =
  "Use dateFormat() from @/lib/utils/date-format: it builds each date formatter once and reuses it. " +
  "Building one inside a function repeats that work on every call (a report built 57,000 a run, Nov 24, 2026).";
const formatterSelectors = [
  { selector: ":function NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat'][arguments.length>0]", message: formatterMessage },
  { selector: ":function CallExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat'][arguments.length>0]", message: formatterMessage },
];

// Report code runs once per line of a report, so the rest of the costly
// locale work is kept out of it too, and its text order is the one the
// groups use (see compareText in query-builder.ts).
const reportSelectors = [
  {
    selector: ":function NewExpression[callee.object.name='Intl'][callee.property.name!='DateTimeFormat']",
    message: "Build an Intl formatter once, at the top of the file (or use dateFormat()): report code runs once per line.",
  },
  {
    selector: "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/][arguments.length>1]",
    message: "Use dateFormat(locale, options).format(date): toLocaleDateString with options builds a new formatter on every call.",
  },
  {
    selector: "CallExpression[callee.property.name='localeCompare']",
    message: "Use compareText() from @/lib/reports/query-builder: it is the order report groups use, so a row limit and the groups agree.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/overlay.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...overlaySelectors, pressSelector, ...formatterSelectors],
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "react-dom", importNames: ["createPortal"], message: portalMessage }] },
      ],
    },
  },
  {
    files: ["src/lib/reports/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", ...overlaySelectors, pressSelector, ...formatterSelectors, ...reportSelectors] },
  },
  {
    files: ownPressListeners,
    rules: { "no-restricted-syntax": ["error", ...overlaySelectors, ...formatterSelectors] },
  },
  {
    // The one place date formatters are built, and tests, which may build
    // one to state what a result should read.
    files: ["src/lib/utils/date-format.ts", "src/**/*.test.{ts,tsx}"],
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
