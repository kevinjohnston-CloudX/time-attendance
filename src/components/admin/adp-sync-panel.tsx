"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { addDays, format } from "date-fns";
import { AlertCircle, ArrowLeft, CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { testAdpConnection, syncAdpEmployees } from "@/actions/adp.actions";
import { parseUtcDate } from "@/lib/utils/date";
import { Badge, Banner, Button, Card, LinkButton, PageHeader, Select, Table, THead, TBody, TR, TH, TD } from "@/components/ui";

/**
 * ADP Sync: both directions of the ADP link on one page, in the Dashboard's
 * card language. Employees come in from ADP when somebody presses Sync
 * employees; hours go out from a locked pay period with Push to ADP on the pay
 * period itself. The top row says when each last happened and what it did;
 * the second row is what a sync needs before it runs.
 *
 * <p>Nothing here runs on a schedule. `syncAdpEmployees` is called from this
 * component and nowhere else, so every figure is as old as the last run.
 *
 * <p>A sync matches people by ADP worker ID only. Anyone in ADP with no match
 * is added as a new employee with the defaults below, which is why the
 * checklist counts active employees with no worker ID, and why the sync asks
 * before it runs.
 */

interface Site {
  id: string;
  name: string;
}
interface Department {
  id: string;
  name: string;
  siteIds: string[];
}
interface RuleSet {
  id: string;
  name: string;
  isDefault: boolean;
}

interface SyncStatus {
  isConfigured: boolean;
  lastSyncAt: Date | null;
  lastSyncResult: unknown;
  adpEmployeeCount: number;
  activeCount: number;
  activeUnlinkedCount: number;
  lastPush: {
    at: Date;
    pushed: number;
    skipped: number;
    errorCount: number;
    payPeriodId: string;
    startDate: Date;
    endDate: Date;
  } | null;
}

interface Props {
  status: SyncStatus;
  sites: Site[];
  departments: Department[];
  ruleSets: RuleSet[];
}

interface SyncResult {
  created: number;
  updated: number;
  deactivated: number;
  errors: string[];
  newCredentials: Array<{ name: string; username: string; tempPassword: string }>;
}

/** The four counts a finished run reports, wherever they were read from. */
interface RunCounts {
  created: number;
  updated: number;
  deactivated: number;
  errorCount: number;
  /** Only the stored record says how many workers ADP returned. */
  totalFetched: number | null;
}

/**
 * The last run's counts, read back out of the audit entry the sync wrote.
 * The three counts only an employee sync writes must be there; anything else
 * is not an employee sync, and the card says nothing rather than something
 * wrong.
 */
function readPersistedRun(raw: unknown): RunCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const after = (raw as { after?: unknown }).after;
  if (!after || typeof after !== "object") return null;
  const a = after as Record<string, unknown>;
  if (typeof a.created !== "number" || typeof a.updated !== "number" || typeof a.deactivated !== "number") return null;
  return {
    created: a.created,
    updated: a.updated,
    deactivated: a.deactivated,
    errorCount: typeof a.errorCount === "number" ? a.errorCount : 0,
    totalFetched: typeof a.totalFetched === "number" ? a.totalFetched : null,
  };
}

const when = (d: Date | string) => format(new Date(d), "MMM d, yyyy 'at' h:mm a");

/** Pay periods end the day after their last day, as everywhere else. */
const periodText = (start: Date, end: Date) =>
  `${format(parseUtcDate(start), "MMM d")} to ${format(addDays(parseUtcDate(end), -1), "MMM d, yyyy")}`;

const SYNC_ERRORS: Record<string, string> = {
  NOT_FOUND: "The default site, department or rule set is no longer available. Pick them again and sync.",
  FORBIDDEN: "You do not have permission to sync employees.",
};

const HERO = { font: "var(--weight-bold) 40px/44px var(--font-sans)", letterSpacing: "-0.03em" } as const;

/** The card's headline figure, the Dashboard's Today figure. */
function Hero({ value, unit }: { value: ReactNode; unit: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="tabular" style={{ ...HERO, color: "var(--text-primary)" }}>
        {value}
      </span>
      <span style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>{unit}</span>
    </div>
  );
}

/** A thin track under the headline figure. */
function Track({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--ta-track)" }} role="presentation">
      <div style={{ width: `${pct}%`, height: "100%", background: "var(--fill-accent)" }} />
    </div>
  );
}

/** One count in a row of tiles, the Dashboard's Team Presence tile. */
function Tile({ label, value, note, tone }: { label: string; value: number; note: string; tone?: "error" }) {
  const hot = tone === "error" && value > 0;
  return (
    <div
      className="flex min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2.5"
      style={{ border: "1px solid var(--stroke-divider)", background: hot ? "var(--surface-error)" : "var(--surface-card)" }}
    >
      <span className="wms-overline truncate">{label}</span>
      <span
        className="tabular"
        style={{ font: "var(--weight-semibold) 22px/28px var(--font-sans)", color: hot ? "var(--text-error)" : "var(--text-primary)" }}
      >
        {value.toLocaleString()}
      </span>
      <span className="truncate" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }} title={note}>
        {note}
      </span>
    </div>
  );
}

/** Where the tiles go before there is anything to count. */
function NoneYet({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="flex flex-col justify-center gap-0.5 rounded-lg px-4 py-3.5"
      style={{ border: "1px dashed var(--stroke-secondary)", minHeight: 86 }}
    >
      <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>{title}</span>
      <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)", textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

/** The last line of a status card: overline on the left, a quiet value on the right. */
function Footer({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="mt-auto flex items-center justify-between gap-3 pt-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
      <span className="wms-overline">{label}</span>
      <span className="tabular truncate" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
        {value}
      </span>
    </div>
  );
}

type Check = "done" | "attention" | "waiting";

const CHECK_ICON: Record<Check, ReactNode> = {
  done: <CheckCircle2 className="h-5 w-5" style={{ color: "var(--text-success)" }} aria-label="Done" />,
  attention: <AlertCircle className="h-5 w-5" style={{ color: "var(--text-warning)" }} aria-label="Needs attention" />,
  waiting: <Circle className="h-5 w-5" style={{ color: "var(--text-tertiary)" }} aria-label="Not yet" />,
};

/** A checklist or settings row. Both cards in the second row use it, so they share one rhythm. */
function ListRow({ lead, label, note, children }: { lead?: ReactNode; label: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3" style={{ minHeight: 72 }}>
      {lead && <span className="flex flex-none self-start pt-0.5">{lead}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>{label}</span>
        {note && <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)", textWrap: "pretty" }}>{note}</span>}
      </span>
      {children && <span className="flex min-w-0 flex-none items-center">{children}</span>}
    </div>
  );
}

function List({ children }: { children: ReactNode }) {
  return <div className="-my-3 flex flex-col divide-y divide-[var(--stroke-divider)]">{children}</div>;
}

/** Two cards to a row, as on the Dashboard; one column when the window is narrow. */
const CARD_GRID = "grid gap-4 items-stretch [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(340px,44%)),1fr))]";

const SELECT_STYLE = { width: 280, maxWidth: "100%" } as const;

export function AdpSyncPanel({ status, sites, departments, ruleSets }: Props) {
  const [isPending, startTransition] = useTransition();
  /** Which action is running; one transition drives both buttons. */
  const [busy, setBusy] = useState<"test" | "sync" | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [ruleSetId, setRuleSetId] = useState((ruleSets.find((r) => r.isDefault) ?? ruleSets[0])?.id ?? "");

  // A department linked to no site is offered everywhere; one linked to sites
  // only where it works, so a new hire is never put in a department their
  // building does not have.
  const siteDepartments = useMemo(
    () => departments.filter((d) => d.siteIds.length === 0 || d.siteIds.includes(siteId)),
    [departments, siteId],
  );
  const [deptPick, setDeptPick] = useState(siteDepartments[0]?.id ?? "");
  const deptId = siteDepartments.some((d) => d.id === deptPick) ? deptPick : (siteDepartments[0]?.id ?? "");

  const credentials = syncResult?.newCredentials ?? [];

  // The temporary passwords exist only on this screen, so leaving it asks.
  useEffect(() => {
    if (!credentials.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [credentials.length]);

  function handleTestConnection() {
    setError(null);
    setTestResult(null);
    setBusy("test");
    startTransition(async () => {
      const result = await testAdpConnection(undefined as never);
      if (!result.success) {
        setTestResult({ success: false, message: result.error });
      } else {
        const sample = result.data.sampleNames.slice(0, 3).join(", ");
        setTestResult({
          success: true,
          message: `ADP answered with ${result.data.workerCount.toLocaleString()} workers${sample ? `, including ${sample}` : ""}.`,
        });
      }
      setBusy(null);
    });
  }

  function handleSync() {
    setConfirming(false);
    setError(null);
    setSyncResult(null);
    setBusy("sync");
    startTransition(async () => {
      const result = await syncAdpEmployees({ defaultSiteId: siteId, defaultDeptId: deptId, defaultRuleSetId: ruleSetId });
      if (!result.success) {
        setError(SYNC_ERRORS[result.error] ?? result.error);
      } else {
        setSyncResult(result.data);
        setSyncedAt(new Date());
      }
      setBusy(null);
    });
  }

  const persisted = readPersistedRun(status.lastSyncResult);
  // A run finished in this tab wins: the page is not fetched again after it.
  const lastRun: RunCounts | null = syncResult
    ? { ...syncResult, errorCount: syncResult.errors.length, totalFetched: null }
    : persisted;
  const lastRunAt = syncedAt ?? (persisted ? status.lastSyncAt : null);

  const canSync = status.isConfigured && !!siteId && !!deptId && !!ruleSetId;
  const siteName = sites.find((s) => s.id === siteId)?.name;
  const deptName = departments.find((d) => d.id === deptId)?.name;
  const ruleSetName = ruleSets.find((r) => r.id === ruleSetId)?.name;
  const push = status.lastPush;

  const unlinked = status.activeUnlinkedCount;
  const linkedActive = status.activeCount - unlinked;
  const linkedPct = status.activeCount ? Math.round((linkedActive / status.activeCount) * 100) : 0;
  const pushTotal = push ? push.pushed + push.skipped : 0;
  const sentPct = push && pushTotal ? Math.round((push.pushed / pushTotal) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        pinned
        title="ADP Sync"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span>ADP Workforce Now</span>
            {status.isConfigured ? (
              <Badge tone="success" dot size="sm">
                Connection details added
              </Badge>
            ) : (
              <Badge tone="warning" dot size="sm">
                Not connected
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            <LinkButton href="/admin" hierarchy="tertiary" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
              Administration
            </LinkButton>
            {status.isConfigured && (
              <>
                <Button hierarchy="secondary" onClick={handleTestConnection} disabled={isPending}>
                  {isPending && busy === "test" ? "Testing…" : "Test connection"}
                </Button>
                <Button
                  hierarchy="primary"
                  leadingIcon={<RefreshCw className="h-4 w-4" />}
                  onClick={() => setConfirming(true)}
                  disabled={isPending || !canSync}
                >
                  {isPending && busy === "sync" ? "Syncing…" : "Sync employees"}
                </Button>
              </>
            )}
          </>
        }
      />

      {testResult && (
        <Banner
          tone={testResult.success ? "success" : "error"}
          title={testResult.success ? "Connected to ADP" : "Could not reach ADP"}
          body={testResult.message}
        />
      )}

      {error && <Banner tone="error" title="The sync did not run" body={error} />}

      {/* ── Row 1: what came in, and what went out ── */}
      <div className={CARD_GRID}>
        <Card title="Employees from ADP" subtitle={lastRunAt ? `Last synced ${when(lastRunAt)}` : "Not synced yet"} fill>
          <div className="flex flex-1 flex-col gap-3.5">
            <Hero value={linkedActive.toLocaleString()} unit={`of ${status.activeCount.toLocaleString()} active employees linked`} />
            <Track pct={linkedPct} />
            {lastRun ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Added" value={lastRun.created} note="New in ADP" />
                <Tile label="Updated" value={lastRun.updated} note="Changed in ADP" />
                <Tile label="Deactivated" value={lastRun.deactivated} note="Left the company" />
                <Tile label="Not added" value={lastRun.errorCount} note="Problem with the record" tone="error" />
              </div>
            ) : (
              <NoneYet title="No sync has run yet" body="What each sync adds, updates and deactivates shows here." />
            )}
            <Footer
              label="Read from ADP"
              value={lastRun?.totalFetched != null ? `${lastRun.totalFetched.toLocaleString()} workers` : "Nothing yet"}
            />
          </div>
        </Card>

        <Card
          title="Hours sent to ADP"
          subtitle={push ? `Last sent ${when(push.at)}` : "Not sent yet"}
          actions={
            <LinkButton href={push ? `/payroll/pay-periods?id=${push.payPeriodId}` : "/payroll/pay-periods"} hierarchy="secondary" size="sm">
              {push ? "Open pay period" : "Open pay periods"}
            </LinkButton>
          }
          fill
        >
          <div className="flex flex-1 flex-col gap-3.5">
            <Hero
              value={push ? push.pushed.toLocaleString() : "0"}
              unit={push ? `of ${pushTotal.toLocaleString()} employees sent` : "pay periods sent"}
            />
            <Track pct={sentPct} />
            {push ? (
              <div className="grid grid-cols-3 gap-3">
                <Tile label="Sent" value={push.pushed} note="Hours from locked timesheets" />
                <Tile label="Skipped" value={push.skipped} note="No ADP worker ID" />
                <Tile label="Not sent" value={push.errorCount} note="No ADP earning code" tone="error" />
              </div>
            ) : (
              <NoneYet title="No hours have been sent yet" body="Lock a pay period, then use Push to ADP on it. What it sent shows here." />
            )}
            <Footer label="Pay period" value={push ? periodText(push.startDate, push.endDate) : "None yet"} />
          </div>
        </Card>
      </div>

      {/* ── Row 2: what a sync needs, and where it puts new people ── */}
      <div className={CARD_GRID}>
        <Card title="Setup checklist" subtitle="What has to be in place before the first sync" fill>
          <List>
            <ListRow
              lead={CHECK_ICON[status.isConfigured ? "done" : "attention"]}
              label="Connection details"
              note={
                status.isConfigured
                  ? "Added to the server settings. Test connection checks that ADP answers."
                  : "Your system administrator adds ADP_CLIENT_ID, ADP_CLIENT_SECRET, ADP_CERT_BASE64 and ADP_KEY_BASE64 to the server settings."
              }
            />
            <ListRow
              lead={CHECK_ICON[unlinked ? "attention" : "done"]}
              label="Employees linked to ADP"
              note={
                unlinked
                  ? `${unlinked.toLocaleString()} active employees have no ADP worker ID. A sync would add each of them again as a new employee, so add the ID on their employee record first.`
                  : "Every active employee has an ADP worker ID."
              }
            >
              <span
                className="tabular whitespace-nowrap"
                style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}
              >
                {linkedPct}%
              </span>
            </ListRow>
            <ListRow
              lead={CHECK_ICON[lastRunAt ? "done" : "waiting"]}
              label="First sync"
              note={lastRunAt ? `Last run ${when(lastRunAt)}.` : "Not run yet. Sync employees asks before it changes anything."}
            />
          </List>
        </Card>

        <Card title="New employee defaults" subtitle="Where a sync puts anyone it adds. Linked employees keep their own." fill>
          <List>
            <ListRow label="Site" note="The building they punch in at">
              <Select aria-label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)} style={SELECT_STYLE} disabled={!sites.length}>
                {sites.length ? (
                  sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                ) : (
                  <option value="">No active sites</option>
                )}
              </Select>
            </ListRow>
            <ListRow label="Department" note="Only departments at that site">
              <Select
                aria-label="Department"
                value={deptId}
                onChange={(e) => setDeptPick(e.target.value)}
                style={SELECT_STYLE}
                disabled={!siteDepartments.length}
              >
                {siteDepartments.length ? (
                  siteDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))
                ) : (
                  <option value="">No departments at this site</option>
                )}
              </Select>
            </ListRow>
            <ListRow label="Rule set" note="How their hours and overtime are worked out">
              <Select
                aria-label="Rule set"
                value={ruleSetId}
                onChange={(e) => setRuleSetId(e.target.value)}
                style={SELECT_STYLE}
                disabled={!ruleSets.length}
              >
                {ruleSets.length ? (
                  ruleSets.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.isDefault ? `${r.name} (default)` : r.name}
                    </option>
                  ))
                ) : (
                  <option value="">No rule sets</option>
                )}
              </Select>
            </ListRow>
          </List>
        </Card>
      </div>

      {credentials.length > 0 && (
        <Card
          title="New employee sign ins"
          subtitle="Shown once. Passwords are stored scrambled, so copy these before leaving this page."
          padding={0}
        >
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Username</TH>
                <TH>Temporary password</TH>
              </TR>
            </THead>
            <TBody>
              {credentials.map((c) => (
                <TR key={c.username}>
                  <TD>{c.name}</TD>
                  {/* Monospace: read aloud and typed by hand, so every character must be told apart. */}
                  <TD style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{c.username}</TD>
                  <TD style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{c.tempPassword}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {syncResult && syncResult.errors.length > 0 && (
        <Card
          title={`Employees not added (${syncResult.errors.length.toLocaleString()})`}
          subtitle="Each of these was skipped whole. Everything else in the sync went through."
        >
          <ul className="flex list-none flex-col gap-1.5 p-0" style={{ margin: 0 }}>
            {syncResult.errors.map((err, i) => (
              <li key={i} style={{ font: "var(--type-body2)", color: "var(--text-error)", textWrap: "pretty" }}>
                {err}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "var(--wms-overlay-modal)" }}
          onClick={(e) => e.target === e.currentTarget && setConfirming(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="adp-sync-title"
            className="ta-modal flex w-full max-w-[460px] flex-col gap-2 p-5"
            style={{ borderRadius: "var(--radius-l)" }}
          >
            <h2 id="adp-sync-title" style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
              Sync employees from ADP?
            </h2>
            <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)", textWrap: "pretty" }}>
              Employees linked to ADP are updated to match it, and anyone who has left is deactivated. Anyone in ADP not linked
              here yet is added as a new employee at {siteName}, in {deptName}, on {ruleSetName}.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button hierarchy="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button hierarchy="primary" onClick={handleSync}>
                Sync employees
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
