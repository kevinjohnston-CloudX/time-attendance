/**
 * Checks that ⌘K lands on the page people mean.
 *
 * <p>Run: `npx tsx scripts/check-palette-ranking.ts` — exits non-zero if any
 * query ranks the wrong destination first.
 *
 * <p>The palette's matcher is hand-written scoring, not a library, and the
 * only thing that makes it feel quick is that short abbreviations hit the
 * right page. That is a property nothing else in the toolchain can check: the
 * component type-checks, renders and lints identically whether "tmcd" finds
 * Timecards or finds nothing at all.
 *
 * <p>Add a case here when you add a destination whose name is not what people
 * would type for it.
 */
import { score } from "../src/components/layout/command-palette";
import { SECTIONS, ADMIN_GROUPS } from "../src/components/layout/nav-model";

const destinations = [
  ...SECTIONS.flatMap((s) => s.items.map((i) => ({ label: i.label, group: s.label }))),
  ...ADMIN_GROUPS.flatMap((g) => g.items.map((i) => ({ label: i.label, group: g.label }))),
];

/** Exactly the ranking CommandPalette performs. */
function rank(query: string): string[] {
  return destinations
    .map((d) => ({
      d,
      s: Math.max(score(d.label, query), score(`${d.group} ${d.label}`, query) - 50),
    }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.d.label);
}

const CASES: [query: string, expectedTopHit: string][] = [
  ["tmcd", "Timecards"],
  ["payper", "Pay Periods"],
  ["timecards", "Timecards"],
  ["exc", "Exceptions"],
  ["audit", "Audit Log"],
  ["punch", "Punch Clock"],
  ["roles", "Roles & Permissions"],
  ["adp", "ADP Sync"],
  ["my leave", "My Leave"],
  ["emp", "Employees"],
  ["wms", "WMS Sync"],
  ["holid", "Holidays"],
  ["dash", "Dashboard"],
  ["reason", "Reason Codes"],
];

let failures = 0;
console.log(`${destinations.length} destinations\n`);

for (const [query, expected] of CASES) {
  const top = rank(query)[0];
  const ok = top === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "  ok   " : "  FAIL "}${JSON.stringify(query).padEnd(12)}-> ${top ?? "(no match)"}` +
      (ok ? "" : `   expected: ${expected}`),
  );
}

// Two invariants that matter as much as the ranking: an empty box offers
// everything, and a query matching nothing says so rather than offering a
// wrong answer confidently.
const everything = rank("").length === destinations.length;
const nothing = rank("qqzzxx").length === 0;
if (!everything) failures++;
if (!nothing) failures++;

console.log();
console.log("empty query returns everything:", everything);
console.log("nonsense returns nothing:      ", nothing);
console.log();

if (failures) {
  console.error(`${failures} failing`);
  process.exit(1);
}
console.log(`all ${CASES.length} queries land on the right page`);
