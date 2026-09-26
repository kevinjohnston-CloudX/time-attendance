"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { addDays, format } from "date-fns";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { testAdpConnection, syncAdpEmployees } from "@/actions/adp.actions";
import { parseUtcDate } from "@/lib/utils/date";
import { Banner, Button, LinkButton, PageHeader, PinnedBar, Select, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { AreaPanel } from "./setup/setup-ui";

/**
 * ADP Sync: both directions of the ADP link on one page. Employees come in
 * from ADP when somebody presses Sync employees; hours go out from a locked
 * pay period with Push to ADP on the pay period itself. The two panels side by
 * side say when each last happened and what it did.
 *
 * <p>Nothing here runs on a schedule. `syncAdpEmployees` is called from this
 * component and nowhere else, so every figure is as old as the last run.
 *
 * <p>A sync matches people by ADP worker ID only. Anyone in ADP with no match
 * is added as a new employee with the defaults below, which is why the page
 * says how many active employees have no worker ID, and why the sync asks
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
 * is not an employee sync, and the panel says nothing rather than something
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

/** One line in a panel: what it is, a quiet note, and its value on the right. */
function Row({ label, note, value, dim }: { label: string; note?: string; value: ReactNode; dim?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5" style={{ minHeight: 52, paddingBlock: 8 }}>
      <span className="flex min-w-0 flex-col">
        <span style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}>{label}</span>
        {note && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{note}</span>}
      </span>
      <span
        className="tabular flex-none text-right"
        style={{
          font: "var(--type-body1)",
          fontWeight: "var(--weight-semibold)",
          color: dim ? "var(--text-tertiary)" : "var(--text-primary)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-[var(--stroke-divider)]">{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      {children}
    </label>
  );
}

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

  return (
    <div className="flex flex-col gap-4">
      <PinnedBar>
        <PageHeader
          title="ADP Sync"
          subtitle="Employees come in from ADP Workforce Now. Hours go back to it from locked pay periods."
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
      </PinnedBar>

      {!status.isConfigured && (
        <Banner
          tone="warning"
          title="ADP is not connected"
          body="Employees cannot be brought in from ADP, and hours cannot be sent to it, until your system administrator adds the ADP connection details."
          meta="For the administrator: ADP_CLIENT_ID, ADP_CLIENT_SECRET, ADP_CERT_BASE64 and ADP_KEY_BASE64 in the server settings."
        />
      )}

      {testResult && (
        <Banner
          tone={testResult.success ? "success" : "error"}
          title={testResult.success ? "Connected to ADP" : "Could not reach ADP"}
          body={testResult.message}
        />
      )}

      {error && <Banner tone="error" title="The sync did not run" body={error} />}

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <AreaPanel title="Employees from ADP" hint="New hires, name and email changes, and people who have left.">
          <Rows>
            <Row label="Last sync" value={lastRunAt ? when(lastRunAt) : "Never"} dim={!lastRunAt} />
            <Row
              label="Linked to ADP"
              note={status.activeUnlinkedCount ? `${status.activeUnlinkedCount.toLocaleString()} active employees have no ADP worker ID` : "Every active employee has an ADP worker ID"}
              value={`${status.adpEmployeeCount.toLocaleString()} employees`}
            />
            <Row label="Added" note="New in ADP, given the sync defaults" value={lastRun ? lastRun.created.toLocaleString() : "None yet"} dim={!lastRun} />
            <Row label="Updated" note="Name, email or status changed in ADP" value={lastRun ? lastRun.updated.toLocaleString() : "None yet"} dim={!lastRun} />
            <Row label="Deactivated" note="Left the company in ADP. Their timesheets stay." value={lastRun ? lastRun.deactivated.toLocaleString() : "None yet"} dim={!lastRun} />
            <Row
              label="Not added"
              note={lastRun?.totalFetched != null ? `Out of ${lastRun.totalFetched.toLocaleString()} workers read from ADP` : "Skipped because of a problem with the record"}
              value={lastRun ? lastRun.errorCount.toLocaleString() : "None yet"}
              dim={!lastRun}
            />
          </Rows>
        </AreaPanel>

        <AreaPanel
          title="Hours sent to ADP"
          hint="Sent from a locked pay period with Push to ADP."
          action={
            <LinkButton href={push ? `/payroll/pay-periods?id=${push.payPeriodId}` : "/payroll/pay-periods"} hierarchy="secondary">
              {push ? "Open pay period" : "Open pay periods"}
            </LinkButton>
          }
        >
          <Rows>
            <Row label="Last sent" value={push ? when(push.at) : "Never"} dim={!push} />
            <Row label="Pay period" value={push ? periodText(push.startDate, push.endDate) : "None yet"} dim={!push} />
            <Row label="Employees sent" note="Hours from their locked timesheets" value={push ? push.pushed.toLocaleString() : "None yet"} dim={!push} />
            <Row label="Skipped" note="No ADP worker ID on the employee" value={push ? push.skipped.toLocaleString() : "None yet"} dim={!push} />
            <Row label="Not sent" note="Hours with no ADP earning code" value={push ? push.errorCount.toLocaleString() : "None yet"} dim={!push} />
          </Rows>
        </AreaPanel>
      </div>

      <AreaPanel
        title="Sync defaults"
        hint="Given to anyone a sync adds. Employees already linked to ADP keep their own site, department and rule set."
      >
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Site">
              <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={{ width: "100%" }} disabled={!sites.length}>
                {sites.length ? sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>) : <option value="">No active sites</option>}
              </Select>
            </Field>
            <Field label="Department">
              <Select value={deptId} onChange={(e) => setDeptPick(e.target.value)} style={{ width: "100%" }} disabled={!siteDepartments.length}>
                {siteDepartments.length
                  ? siteDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)
                  : <option value="">No departments at this site</option>}
              </Select>
            </Field>
            <Field label="Rule set">
              <Select value={ruleSetId} onChange={(e) => setRuleSetId(e.target.value)} style={{ width: "100%" }} disabled={!ruleSets.length}>
                {ruleSets.length
                  ? ruleSets.map((r) => <option key={r.id} value={r.id}>{r.isDefault ? `${r.name} (default)` : r.name}</option>)
                  : <option value="">No rule sets</option>}
              </Select>
            </Field>
          </div>
          {status.activeUnlinkedCount > 0 && (
            <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-warning)", textWrap: "pretty" }}>
              A sync matches people by ADP worker ID only. Anyone in ADP without a match here is added as a new employee, so add the ADP worker ID to existing employee records before the first sync.
            </p>
          )}
        </div>
      </AreaPanel>

      {credentials.length > 0 && (
        <AreaPanel
          title="New employee sign ins"
          hint="Shown once. Passwords are stored scrambled, so copy these before leaving this page."
          count={`${credentials.length.toLocaleString()} ${credentials.length === 1 ? "employee" : "employees"}`}
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
        </AreaPanel>
      )}

      {syncResult && syncResult.errors.length > 0 && (
        <AreaPanel
          title="Employees not added"
          hint="Each of these was skipped whole. Everything else in the sync went through."
          count={`${syncResult.errors.length.toLocaleString()} ${syncResult.errors.length === 1 ? "record" : "records"}`}
        >
          <ul className="flex list-none flex-col gap-1.5 px-5 py-4" style={{ margin: 0 }}>
            {syncResult.errors.map((err, i) => (
              <li key={i} style={{ font: "var(--type-body2)", color: "var(--text-error)", textWrap: "pretty" }}>
                {err}
              </li>
            ))}
          </ul>
        </AreaPanel>
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
              Employees linked to ADP are updated to match it, and anyone who has left is deactivated. Anyone in ADP not linked here yet is added as a new employee at {siteName}, in {deptName}, on {ruleSetName}.
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
