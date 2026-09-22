/**
 * Checks which nav item lights up, and what the breadcrumb says, for a path.
 *
 * <p>Run: `npx tsx scripts/check-nav-resolution.ts` — exits non-zero on any
 * mismatch.
 *
 * <p>Two functions decide this for every page in the portal, and both have
 * behaviour that is easy to get subtly wrong and impossible to notice from a
 * type signature:
 *
 * <ul>
 * <li><b>activeHref</b> — longest match wins, so /payroll/timecards highlights
 *     Timecards rather than Pay Periods. It matches on the href plus a slash,
 *     so /payroll cannot claim a future /payroll-archive.
 * <li><b>locate</b> — falls back to the section when a path is not itself a
 *     nav destination, so a record page still says Administration instead of
 *     showing an empty breadcrumb.
 * </ul>
 */
import { activeHref, locate, SECTIONS } from "../src/components/layout/nav-model";

const ALL_HREFS = SECTIONS.flatMap((s) => s.items.map((i) => i.href));

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "  ok   " : "  FAIL "}${label.padEnd(42)}${String(actual)}` +
      (ok ? "" : `   expected: ${String(expected)}`),
  );
}

console.log("activeHref — which nav row is highlighted\n");

// Exact matches.
check("/dashboard", activeHref("/dashboard", ALL_HREFS), "/dashboard");
check("/payroll", activeHref("/payroll", ALL_HREFS), "/payroll");

// Longest match wins: /payroll/timecards is its own destination, and must not
// resolve to /payroll just because that also prefixes it.
check("/payroll/timecards", activeHref("/payroll/timecards", ALL_HREFS), "/payroll/timecards");

// A child route with no destination of its own falls back to its parent.
check("/time/timesheet/abc123", activeHref("/time/timesheet/abc123", ALL_HREFS), "/time/timesheet");
check("/supervisor/timesheets/x", activeHref("/supervisor/timesheets/x", ALL_HREFS), "/supervisor/timesheets");

// The slash guard: a sibling that merely starts with the same characters is
// not a child, and must not light up the parent.
check("/payroll-archive (no match)", activeHref("/payroll-archive", ALL_HREFS), null);
check("/leaverequest (no match)", activeHref("/leaverequest", ALL_HREFS), null);

// Unknown paths resolve to nothing rather than guessing.
check("/nowhere (no match)", activeHref("/nowhere", ALL_HREFS), null);

console.log("\nlocate — what the breadcrumb says\n");

const where = (p: string) => {
  const r = locate(p);
  return r ? `${r.section.label}${r.item ? ` > ${r.item.label}` : ""}` : "(nothing)";
};

// Destinations name their section and their page.
check("/dashboard", where("/dashboard"), "Me > Dashboard");
check("/supervisor/exceptions", where("/supervisor/exceptions"), "Team > Exceptions");
check("/payroll/timecards", where("/payroll/timecards"), "Payroll > Timecards");
check("/admin/audit", where("/admin/audit"), "Administration > Audit Log");

// Record pages are not destinations. The section is still true, and stopping
// there is honest — better than an empty breadcrumb on the screen where
// knowing your location matters most.
check("/admin/sites/abc123", where("/admin/sites/abc123"), "Administration");
check("/admin/employees/abc123", where("/admin/employees/abc123"), "Administration > Employees");
check("/accruals/abc123", where("/accruals/abc123"), "Me > Accruals");
check("/reports/abc123", where("/reports/abc123"), "Payroll > Reports");
check("/payroll/pay-periods/abc", where("/payroll/pay-periods/abc"), "Payroll > Pay Periods");

// Outside the portal entirely.
check("/login", where("/login"), "(nothing)");

console.log();
if (failures) {
  console.error(`${failures} failing`);
  process.exit(1);
}
console.log("nav resolution is correct on every path checked");
