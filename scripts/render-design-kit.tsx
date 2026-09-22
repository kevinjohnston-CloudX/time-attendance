/**
 * Renders every design-system component to a standalone HTML file.
 *
 * <p>Run: `npx tsx scripts/render-design-kit.tsx` — writes design-kit.html and
 * opens in any browser. No server, no database, no login.
 *
 * <p>This exists because the portal is behind auth, so the only way to look at
 * the kit was to sign in and hunt for a page that happened to use the
 * component you wanted to check. It is also the thing that catches what
 * TypeScript cannot: a class string that compiles perfectly and renders wrong.
 *
 * <p>The design system ships its own specimen cards (guidelines/*.card.html).
 * This is the same idea for our React port of it.
 */
// Explicit, because the repo's tsconfig sets jsx: "preserve" for Next and tsx
// falls back to the classic transform, which expects React in scope.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  LinkButton,
  FilterBar,
  FilterChip,
  PageHeader,
  SearchInput,
  SegmentedLinks,
  Select,
  SelectionBar,
  StatCard,
  Toolbar,
  Switch,
  Table,
  TBody,
  TD,
  Textarea,
  TFoot,
  TH,
  THead,
  TR,
  type BadgeTone,
} from "../src/components/ui";
import { PunchHistoryTable } from "../src/components/time/punch-history-table";
import { HoursReportTable, type ReportRow } from "../src/components/reports/hours-report-table";
import { ResultsTable } from "../src/components/reports/report-results/results-table";
import { AdminHub } from "../src/app/(portal)/admin/admin-hub";
import { ADMIN_GROUPS } from "../src/components/layout/nav-model";
import { IdCard, Network, ShieldCheck, ScrollText } from "lucide-react";
import type { Punch } from "@prisma/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { EmployeesTable } from "../src/components/admin/employees-table";

/**
 * A router that does nothing, so components calling useRouter can render.
 *
 * <p>Three converted components — the employees table, team punch history and
 * the command palette — read navigation state. Without this they throw on the
 * first hook and cannot be looked at outside a signed-in browser, which is
 * exactly the wrong place for the ones with the most markup.
 *
 * <p>These context modules are Next internals. Acceptable here because this
 * script is a local preview tool, not shipped code — if a Next upgrade moves
 * them, this file fails loudly and nothing in the app is affected.
 */
const noop = () => {};
const stubRouter = {
  push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop,
} as unknown as React.ContextType<typeof AppRouterContext>;

function WithRouter({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <AppRouterContext.Provider value={stubRouter}>
      <PathnameContext.Provider value={path}>
        <SearchParamsContext.Provider value={new URLSearchParams() as never}>
          {children}
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}

const TONES: BadgeTone[] = ["neutral", "success", "warning", "error", "info", "purple"];

/**
 * Mock rows for the product surfaces below.
 *
 * <p>Deliberately includes the awkward cases, because those are the ones worth
 * looking at: a punch superseded by a correction (struck through, dimmed), the
 * correction itself (badged), and one still pending approval.
 */
const punch = (o: Partial<Punch> & { id: string; punchTime: Date }): Punch =>
  ({
    isApproved: true,
    isRejected: false,
    correctedById: null,
    correctsId: null,
    punchType: "CLOCK_IN",
    source: "KIOSK",
    roundedTime: o.punchTime,
    ...o,
  }) as Punch;

const MOCK_PUNCHES: Punch[] = [
  punch({ id: "1", punchTime: new Date("2026-09-15T08:01:12"), punchType: "CLOCK_IN" as Punch["punchType"] }),
  punch({
    id: "2",
    punchTime: new Date("2026-09-15T12:04:41"),
    punchType: "MEAL_START" as Punch["punchType"],
    correctedById: "3",
  }),
  punch({
    id: "3",
    punchTime: new Date("2026-09-15T12:00:00"),
    punchType: "MEAL_START" as Punch["punchType"],
    correctsId: "2",
    source: "MANUAL" as Punch["source"],
  }),
  punch({
    id: "4",
    punchTime: new Date("2026-09-15T16:31:58"),
    punchType: "CLOCK_OUT" as Punch["punchType"],
    isApproved: false,
  }),
];

/**
 * Hours report rows.
 *
 * <p>Chosen to exercise the colour rule: zero is dimmed, anything above it is
 * coloured, so a period's overtime can be found by scanning the column. One
 * employee with OT, one with DT, one with PTO, one clean.
 */
const MOCK_REPORT: ReportRow[] = [
  { employeeId: "a", name: "Marcus Webb", department: "Inbound", regMinutes: 4692, otMinutes: 270, dtMinutes: 0, ptoMinutes: 0, totalMinutes: 4962, status: "SUBMITTED" },
  { employeeId: "b", name: "Priya Raman", department: "Inbound", regMinutes: 4320, otMinutes: 0, dtMinutes: 0, ptoMinutes: 480, totalMinutes: 4800, status: "APPROVED" },
  { employeeId: "c", name: "Tomas Alvarez", department: "Shipping", regMinutes: 4800, otMinutes: 540, dtMinutes: 240, ptoMinutes: 0, totalMinutes: 5580, status: "OPEN" },
  { employeeId: "d", name: "Grace Okafor", department: "Returns", regMinutes: 4080, otMinutes: 0, dtMinutes: 0, ptoMinutes: 0, totalMinutes: 4080, status: "LOCKED" },
];

const REPORT_COLUMNS = [
  { id: "employee", label: "Employee", type: "string" },
  { id: "site", label: "Site", type: "string" },
  { id: "hours", label: "Hours", type: "number" },
  { id: "approved", label: "Approved", type: "boolean" },
];

const REPORT_ROWS = [
  { employee: "Marcus Webb", site: "0299 Rutherford", hours: 4962, approved: true },
  { employee: "Priya Raman", site: "0299 Rutherford", hours: 4800, approved: false },
  { employee: "Tomas Alvarez", site: "5903 Nj", hours: 5580, approved: null },
];

/**
 * Employees, covering every status and role badge.
 *
 * <p>The role pills are the reason this one is worth looking at: they used to
 * be Tailwind classes with no dark variants, so in dark mode every one of them
 * was dark text on a light fill.
 */
const MOCK_EMPLOYEES = [
  { id: "1", employeeCode: "0000123456", role: "EMPLOYEE", isActive: true, onLeave: false, hireDate: new Date("2023-04-11"), user: { name: "Marcus Webb", email: "marcus.webb@example.com" }, site: { name: "0299 Rutherford" }, department: { name: "Inbound" }, customRole: null },
  { id: "2", employeeCode: "0000123457", role: "SUPERVISOR", isActive: true, onLeave: true, hireDate: new Date("2021-09-02"), user: { name: "Priya Raman", email: null }, site: { name: "0299 Rutherford" }, department: { name: "Inbound" }, customRole: null },
  { id: "3", employeeCode: "0000123458", role: "PAYROLL_ADMIN", isActive: true, onLeave: false, hireDate: new Date("2019-01-28"), user: { name: "Tomas Alvarez", email: "t.alvarez@example.com" }, site: { name: "5903 Nj" }, department: { name: "Shipping" }, customRole: null },
  { id: "4", employeeCode: "0000123459", role: "HR_ADMIN", isActive: false, onLeave: false, hireDate: new Date("2020-06-15"), user: { name: "Grace Okafor", email: null }, site: { name: "7575 Georgia" }, department: { name: "Returns" }, customRole: null },
  { id: "5", employeeCode: "0000123460", role: "SYSTEM_ADMIN", isActive: true, onLeave: false, hireDate: new Date("2018-03-05"), user: { name: "Dana Alvarez", email: "dana@example.com" }, site: { name: "5903 Nj" }, department: { name: "Operations" }, customRole: null },
  { id: "6", employeeCode: "0000123461", role: "EMPLOYEE", isActive: true, onLeave: false, hireDate: new Date("2024-11-19"), user: { name: "Sam Iyer", email: null }, site: { name: "6002 California" }, department: { name: "Outbound" }, customRole: { id: "cr1", name: "Shift Lead" } },
];

/** Two real groups from the nav model, with the icons the hub attaches. */
const HUB_ICONS: Record<string, React.ReactNode> = {
  "/admin/employees": <IdCard className="h-5 w-5" />,
  "/admin/site-settings?tab=departments": <Network className="h-5 w-5" />,
  "/admin/roles": <ShieldCheck className="h-5 w-5" />,
  "/admin/audit": <ScrollText className="h-5 w-5" />,
};

const MOCK_HUB = ADMIN_GROUPS.slice(0, 1).map((g) => ({
  label: g.label,
  hint: g.hint,
  items: g.items.map((i) => ({
    label: i.label,
    detail: i.detail,
    href: i.href,
    icon: HUB_ICONS[i.href] ?? <IdCard className="h-5 w-5" />,
  })),
}));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
      <h2
        style={{
          margin: 0,
          font: "var(--type-overline)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--text-tertiary)",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>{children}</div>;
}

function Specimen() {
  return (
    <div style={{ padding: "16px 16px 48px", maxWidth: 1080, margin: "0 auto" }}>
      <PageHeader
        title="Design System"
        subtitle="Every component in the CloudTime kit, rendered from source"
        actions={<Button>Primary action</Button>}
      />

      <div style={{ height: 24 }} />

      <Section title="Buttons">
        <Row>
          <Button>Primary</Button>
          <Button hierarchy="secondary">Secondary</Button>
          <Button hierarchy="tertiary">Tertiary</Button>
          <Button hierarchy="link">Link</Button>
          <Button tone="error">Danger</Button>
          <Button tone="success">Success</Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row>
          <Button size="sm">Small</Button>
          <Button size="sm" hierarchy="secondary">Small secondary</Button>
          <LinkButton href="#">LinkButton</LinkButton>
          <LinkButton href="#" hierarchy="primary">LinkButton primary</LinkButton>
        </Row>
      </Section>

      <Section title="Badges">
        <Row>
          {TONES.map((t) => (
            <Badge key={t} tone={t}>{t}</Badge>
          ))}
        </Row>
        <Row>
          {TONES.map((t) => (
            <Badge key={t} tone={t} dot size="sm">{t} sm</Badge>
          ))}
        </Row>
        <Row>
          {TONES.map((t) => (
            <Badge key={t} tone={t} variant="solid">{t}</Badge>
          ))}
        </Row>
      </Section>

      <Section title="Fields">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          <Input label="Employee name" placeholder="Type a name" defaultValue="Dana Alvarez" />
          <Input label="Badge number" required hint="Ten digits, zero padded" defaultValue="0000123456" />
          <Input label="Rejected" error="This badge is already assigned" defaultValue="0000123456" />
          <Input label="Display only" readOnly defaultValue="Read-only value" />
          <Input label="Disabled" disabled defaultValue="Cannot edit" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>Select</span>
            <Select defaultValue="b">
              <option value="a">Weekly</option>
              <option value="b">Bi-weekly</option>
            </Select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>Search</span>
            <SearchInput value="" onValueChange={() => {}} placeholder="Search pages" />
          </div>
        </div>
        <Textarea label="Note" rows={3} placeholder="Explain why this punch was missed" />
        <Row>
          <Checkbox checked label="Checked" />
          <Checkbox label="Unchecked" />
          <Checkbox indeterminate label="Indeterminate" />
          <Checkbox checked disabled label="Disabled" />
          <Switch checked label="On" />
          <Switch label="Off" />
          <Switch checked size="sm" label="Small" />
        </Row>
      </Section>

      <Section title="Segmented control">
        <Row>
          <SegmentedLinks
            active="all"
            items={[
              { value: "all", label: "All", href: "#", count: 10 },
              { value: "issues", label: "Needs attention", href: "#", count: 3 },
              { value: "clean", label: "Clean", href: "#", count: 7 },
            ]}
          />
        </Row>
        <Row>
          <SegmentedLinks
            size="sm"
            active="b"
            items={[
              { value: "a", label: "Properties", href: "#" },
              { value: "b", label: "Posting", href: "#" },
              { value: "c", label: "Computation", href: "#" },
            ]}
          />
        </Row>
      </Section>

      <Section title="List toolbar">
        <Toolbar count={12} countLabel="record">
          <SegmentedLinks
            size="sm"
            active="all"
            items={[
              { value: "all", label: "All", href: "#" },
              { value: "open", label: "Open", href: "#" },
            ]}
          />
        </Toolbar>
        <FilterBar clearHref="#">
          <FilterChip key="dept" label="Department" />
          <FilterChip key="site" label="Site" value="5903" clearHref="#" />
        </FilterBar>
        <SelectionBar label="3 selected">
          <Button size="sm">Approve</Button>
          <Button size="sm" hierarchy="secondary">Return for Edit</Button>
        </SelectionBar>
      </Section>

      <Section title="Stat cards">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }}>
          <StatCard label="Total Timesheets" value="214" />
          <StatCard label="Approved" value="198" tone="success" />
          <StatCard label="Pending / Issues" value="16" tone="error" />
          <StatCard label="Pay Period Hours" value="46:20" sub="Sep 7 – Sep 20" />
        </div>
      </Section>

      <Section title="Card">
        <Card title="Period Summary" subtitle="Sep 7 – Sep 20" actions={<Button size="sm" hierarchy="secondary">Export</Button>}>
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
            Card body. Hairline ring plus a soft ambient drop — crisp and low-float, never heavy.
          </p>
        </Card>
      </Section>

      <Section title="Table">
        <Card padding={0}>
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Department</TH>
                <TH numeric>REG</TH>
                <TH numeric>OT</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>Marcus Webb</TD>
                <TD>Inbound</TD>
                <TD numeric>78.20</TD>
                <TD numeric style={{ color: "var(--text-warning)" }}>4.50</TD>
                <TD><Badge tone="info" size="sm" dot>Submitted</Badge></TD>
              </TR>
              <TR>
                <TD>Priya Raman</TD>
                <TD>Inbound</TD>
                <TD numeric>72.00</TD>
                <TD numeric style={{ color: "var(--text-tertiary)" }}>0.00</TD>
                <TD><Badge tone="success" size="sm" dot>Approved</Badge></TD>
              </TR>
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={2} style={{ fontWeight: "var(--weight-semibold)", borderBottom: "none" }}>
                  Totals (2 employees)
                </TD>
                <TD numeric style={{ fontWeight: "var(--weight-semibold)", borderBottom: "none" }}>150.20</TD>
                <TD numeric style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-warning)", borderBottom: "none" }}>4.50</TD>
                <TD style={{ borderBottom: "none" }} />
              </TR>
            </TFoot>
          </Table>
        </Card>
      </Section>

      {/* Real product surfaces, not kit specimens. These are the actual
          components the app renders, fed mock data — the only way to look at a
          converted screen without signing in. Only components free of
          useRouter/usePathname can appear here; the rest need a router. */}
      <Section title="Product surface — Punch History">
        <PunchHistoryTable punches={MOCK_PUNCHES} />
      </Section>

      <Section title="Product surface — Punch History, empty">
        <PunchHistoryTable
          punches={[]}
          emptyTitle="Nothing punched today"
          emptyBody="Your first scan of the day will appear here."
        />
      </Section>

      <Section title="Product surface — Hours report (totals row, numeric colour rule)">
        <HoursReportTable rows={MOCK_REPORT} periodLabel="Sep 7 – Sep 20" />
      </Section>

      <Section title="Product surface — Report results">
        <ResultsTable columns={REPORT_COLUMNS} rows={REPORT_ROWS} totalRows={REPORT_ROWS.length} />
      </Section>

      <Section title="Product surface — Report results, empty">
        <ResultsTable columns={REPORT_COLUMNS} rows={[]} totalRows={0} />
      </Section>

      <Section title="Product surface — Employees (every role and status badge)">
        <WithRouter path="/admin/employees">
          <EmployeesTable
            employees={MOCK_EMPLOYEES}
            total={214}
            page={0}
            pageSize={6}
            sites={["0299 Rutherford", "5903 Nj", "7575 Georgia", "6002 California"]}
            departments={["Inbound", "Outbound", "Shipping", "Returns", "Operations"]}
            currentFilters={{ q: "", site: "", dept: "", role: "" }}
          />
        </WithRouter>
      </Section>

      <Section title="Product surface — Employees, filtered to nothing">
        <WithRouter path="/admin/employees">
          <EmployeesTable
            employees={[]}
            total={0}
            page={0}
            pageSize={25}
            sites={["0299 Rutherford"]}
            departments={["Inbound"]}
            currentFilters={{ q: "zzz", site: "0299 Rutherford", dept: "", role: "" }}
          />
        </WithRouter>
      </Section>

      <Section title="Product surface — Administration hub">
        <AdminHub groups={MOCK_HUB} />
      </Section>

      <Section title="Empty state">
        <Card padding={0}>
          <EmptyState
            title="Nothing matches these filters"
            body="There may still be exceptions outside the site, department, type or pay period you have selected."
            action={<Button size="sm" hierarchy="secondary">Reset filters</Button>}
          />
        </Card>
      </Section>
    </div>
  );
}

const root = process.cwd();
const tokens = ["fonts", "colors", "typography", "spacing", "dark"]
  .map((f) => readFileSync(join(root, "src/styles/wms", `${f}.css`), "utf8"))
  .join("\n");

// The parts of globals.css that are plain CSS rather than Tailwind directives.
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
const appRules = globals.slice(globals.indexOf("/* Form fields."));

const body = renderToStaticMarkup(<Specimen />);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CloudTime Design System</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
${tokens}
${appRules}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font: var(--type-body1); font-family: var(--font-sans);
       background: var(--surface-page); color: var(--text-primary);
       -webkit-font-smoothing: antialiased; }
input, button, select, textarea { font-family: inherit; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.theme-switch { position: fixed; top: 12px; right: 12px; z-index: 10; }
</style>
</head>
<body>
<button class="theme-switch ta-outlined" style="border:1px solid var(--stroke-secondary);background:var(--surface-card);color:var(--text-secondary);height:28px;border-radius:6px;padding:0 10px;cursor:pointer"
        onclick="document.documentElement.toggleAttribute('data-theme-dark');document.documentElement.setAttribute('data-theme',document.documentElement.hasAttribute('data-theme-dark')?'dark':'light')">
  Toggle theme
</button>
${body}
</body>
</html>`;

const out = join(root, "design-kit.html");
writeFileSync(out, html, "utf8");
console.log(`wrote ${out} (${Math.round(html.length / 1024)} KB)`);
