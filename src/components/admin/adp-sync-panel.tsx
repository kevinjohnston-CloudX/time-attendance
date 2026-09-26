"use client";

import { useState, useTransition, type ReactNode } from "react";
import { format } from "date-fns";
import { testAdpConnection, syncAdpEmployees } from "@/actions/adp.actions";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Select,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from "@/components/ui";

/**
 * ADP Sync, on the portal design's doc template: a connection banner, the
 * connection figures, the defaults a new hire inherits, and what the last run
 * actually did.
 *
 * <p>The page header lives here rather than in the server page because "Sync
 * Now" is a page action that runs with the three mapping defaults below it.
 *
 * <p>Nothing on this screen happens on a schedule. There is no ADP cron —
 * `syncAdpEmployees` is called from this component and nowhere else — so the
 * figures are as old as the last time somebody pressed the button, and the
 * banner says so. A page that implied a nightly sync would be the difference
 * between "ADP is behind" and "ADP is broken".
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
}

interface Props {
  status: SyncStatus;
  sites: Site[];
  departments: Department[];
  ruleSets: RuleSet[];
}

/** The four counts a finished run reports, wherever they were read from. */
interface RunCounts {
  created: number;
  updated: number;
  deactivated: number;
  errorCount: number;
  /** Only the audit entry records how many workers ADP returned. */
  totalFetched: number | null;
  when: string;
}

/**
 * The last run's counts, read back out of the audit entry the sync wrote.
 *
 * <p>`lastSyncResult` is the audit row's whole `changes` blob — `{ after: … }` —
 * and it arrives typed `unknown` because until now nothing rendered it. Without
 * this the result card stays empty until somebody runs a sync in this very
 * browser tab, which is the one moment it is not needed: the question this page
 * gets opened for is what happened last time.
 *
 * <p>The blob is not necessarily an employee sync. `getAdpSyncStatus` takes the
 * newest audit row of entityType ADP_SYNC, and the payroll push writes under
 * that same entity type with an entirely different payload —
 * `{ pushed, skipped, errorCount, totalEntries }`. Defaulting the missing keys
 * to zero would draw a payroll push as an employee sync that created, updated
 * and deactivated nobody, three figures nothing ever measured, while carrying
 * the push's `errorCount` into the Errors row as if workers had been refused.
 * So the three counts only this sync writes have to actually be there; when
 * they are not, this is somebody else's audit entry and the card says nothing
 * rather than something wrong.
 */
function readPersistedRun(raw: unknown): Omit<RunCounts, "when"> | null {
  if (!raw || typeof raw !== "object") return null;
  const after = (raw as { after?: unknown }).after;
  if (!after || typeof after !== "object") return null;

  const a = after as Record<string, unknown>;
  if (
    typeof a.created !== "number" ||
    typeof a.updated !== "number" ||
    typeof a.deactivated !== "number"
  ) {
    return null;
  }

  return {
    created: a.created,
    updated: a.updated,
    deactivated: a.deactivated,
    errorCount: typeof a.errorCount === "number" ? a.errorCount : 0,
    totalFetched: typeof a.totalFetched === "number" ? a.totalFetched : null,
  };
}

/** A labelled field in the doc template's field grid. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      {children}
    </label>
  );
}

/** One figure in the doc template's key-value row. */
function Kv({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="wms-overline">{label}</span>
      <span
        className="tabular"
        style={{
          font: "var(--weight-semibold) 16px/22px var(--font-sans)",
          color: "var(--text-primary)",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** The design's doc field grid at three columns. */
const FIELD_GRID =
  "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,32%)),1fr))]";

export function AdpSyncPanel({ status, sites, departments, ruleSets }: Props) {
  const [isPending, startTransition] = useTransition();
  /**
   * Which of the two actions is running. One transition drives both buttons, so
   * without this a sync makes "Test Connection" say "Testing…" as well. Always
   * read together with `isPending`, so a request that never resolves cannot
   * leave a button stuck on its busy label.
   */
  const [busy, setBusy] = useState<"test" | "sync" | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [syncResult, setSyncResult] = useState<{
    created: number;
    updated: number;
    deactivated: number;
    errors: string[];
    newCredentials: Array<{ name: string; username: string; tempPassword: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default selections
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [deptId, setDeptId] = useState(departments[0]?.id ?? "");
  const [ruleSetId, setRuleSetId] = useState((ruleSets.find((r) => r.isDefault) ?? ruleSets[0])?.id ?? "");

  function handleTestConnection() {
    setError(null);
    setTestResult(null);
    setBusy("test");
    startTransition(async () => {
      const result = await testAdpConnection(undefined as never);
      if (!result.success) {
        setTestResult({ success: false, message: result.error });
        setBusy(null);
        return;
      }
      setTestResult({
        success: true,
        message: `Connected! Found ${result.data.workerCount} workers. Sample: ${result.data.sampleNames.join(", ")}`,
      });
      setBusy(null);
    });
  }

  function handleSync() {
    if (!siteId || !deptId || !ruleSetId) {
      setError("Please select a default site, department, and rule set.");
      return;
    }
    setError(null);
    setSyncResult(null);
    setBusy("sync");
    startTransition(async () => {
      const result = await syncAdpEmployees({
        defaultSiteId: siteId,
        defaultDeptId: deptId,
        defaultRuleSetId: ruleSetId,
      });
      if (!result.success) {
        setError(result.error);
        setBusy(null);
        return;
      }
      setSyncResult(result.data);
      setBusy(null);
    });
  }

  const persisted = readPersistedRun(status.lastSyncResult);

  // A run completed in this tab wins over the audit entry: the page is not
  // re-fetched after a sync, so the stored figures are the previous run's.
  const lastRun: RunCounts | null = syncResult
    ? {
        created: syncResult.created,
        updated: syncResult.updated,
        deactivated: syncResult.deactivated,
        errorCount: syncResult.errors.length,
        totalFetched: null,
        when: "just now",
      }
    : persisted && status.lastSyncAt
      ? { ...persisted, when: format(new Date(status.lastSyncAt), "d MMM yyyy · HH:mm") }
      : null;

  const outcomeRows = lastRun
    ? [
        // Details stay on one line: the Table sizes itself to max-content, so a
        // wrapping cell would widen the whole card rather than growing taller.
        {
          outcome: "Created",
          count: lastRun.created,
          detail: "New workers, given the mapping defaults",
        },
        {
          outcome: "Updated",
          count: lastRun.updated,
          detail: "Name, email or active flag changed in ADP",
        },
        {
          outcome: "Deactivated",
          count: lastRun.deactivated,
          detail: "Terminated in ADP; their timesheets stay",
        },
        {
          outcome: "Errors",
          count: lastRun.errorCount,
          detail: "Refused rows — each is skipped whole",
        },
      ]
    : [];

  return (
    <>
      <PageHeader pinned
        title="ADP Sync"
        subtitle="Sync employee data from ADP Workforce Now"
        actions={
          <>
            <LinkButton href="/admin" hierarchy="tertiary">
              ← Administration
            </LinkButton>
            {status.isConfigured && (
              <Button hierarchy="primary" onClick={handleSync} disabled={isPending}>
                {isPending && busy === "sync" ? "Syncing…" : "Sync Now"}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-4" style={{ maxWidth: 760 }}>
        {status.isConfigured ? (
          // Info, not success: configured means the environment variables are
          // present, which is not the same as ADP answering. Test Connection is
          // what turns this page green, and it says so underneath.
          <Banner
            tone="info"
            title="ADP credentials are configured"
            body="Nothing runs on a schedule — a sync only happens when somebody presses Sync Now, so everything below is as old as the last run."
            actions={
              <Button hierarchy="secondary" onClick={handleTestConnection} disabled={isPending}>
                {isPending && busy === "test" ? "Testing…" : "Test Connection"}
              </Button>
            }
          />
        ) : (
          <Banner
            tone="warning"
            title="ADP is not configured"
            body="Set ADP_CLIENT_ID, ADP_CLIENT_SECRET, ADP_CERT_BASE64 and ADP_KEY_BASE64 in the environment. Until they are set there is nothing for a sync to call."
          />
        )}

        {testResult && (
          <Banner
            tone={testResult.success ? "success" : "error"}
            title={testResult.success ? "Connection test passed" : "Connection test failed"}
            body={testResult.message}
          />
        )}

        {error && <Banner tone="error" title="Sync failed" body={error} />}

        <Card title="Connection" subtitle="What this tenant currently has from ADP">
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
            <Kv label="Credentials" value={status.isConfigured ? "Configured" : "Missing"} />
            <Kv
              label="Last sync"
              value={
                status.lastSyncAt
                  ? format(new Date(status.lastSyncAt), "d MMM yyyy · HH:mm")
                  : "Never"
              }
            />
            <Kv label="ADP-linked employees" value={status.adpEmployeeCount} />
          </div>
        </Card>

        {status.isConfigured && (
          <Card
            title="Mapping Defaults"
            subtitle="Applied to new hires arriving from ADP with no match. Existing employees keep what they have."
          >
            <div className={FIELD_GRID}>
              <Field label="Default Site">
                <Select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Default Department">
                <Select
                  value={deptId}
                  onChange={(e) => setDeptId(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.siteIds.length > 0
                        ? ` (${d.siteIds.map((id) => sites.find((s) => s.id === id)?.name).filter(Boolean).join(", ")})`
                        : ""}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Default Rule Set">
                <Select
                  value={ruleSetId}
                  onChange={(e) => setRuleSetId(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {ruleSets.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>
        )}

        <Card
          title="Last Sync Result"
          subtitle={
            lastRun
              ? [
                  `Run ${lastRun.when}`,
                  lastRun.totalFetched !== null && `${lastRun.totalFetched} workers fetched`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "No sync recorded yet"
          }
          padding={0}
        >
          {lastRun ? (
            <Table>
              <THead>
                <TR>
                  <TH>Outcome</TH>
                  <TH numeric>Records</TH>
                  <TH>Detail</TH>
                </TR>
              </THead>
              <TBody>
                {outcomeRows.map((r) => (
                  <TR key={r.outcome}>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{r.outcome}</TD>
                    <TD numeric>{r.count}</TD>
                    <TD style={{ color: "var(--text-secondary)" }}>{r.detail}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState
              title="No sync result recorded"
              body="Once a sync finishes, what it created, updated and refused is recorded here and survives a reload."
            />
          )}
        </Card>

        {/* Temporary passwords, shown once and never stored in the clear. */}
        {syncResult && syncResult.newCredentials.length > 0 && (
          <Card
            title="New Employee Credentials"
            subtitle="Shown once. Leaving this page loses them — the passwords are only stored hashed."
            padding={0}
          >
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Username</TH>
                  <TH>Temp Password</TH>
                </TR>
              </THead>
              <TBody>
                {syncResult.newCredentials.map((cred) => (
                  <TR key={cred.username}>
                    <TD>{cred.name}</TD>
                    {/* Monospace: these get read aloud and typed in by hand, so
                        the characters have to be distinguishable from each
                        other. */}
                    <TD style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                      {cred.username}
                    </TD>
                    <TD style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                      {cred.tempPassword}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}

        {syncResult && syncResult.errors.length > 0 && (
          <Card
            title={`Errors (${syncResult.errors.length})`}
            subtitle="Workers this run could not apply. Everything else in the run still landed."
          >
            <ul className="flex list-none flex-col gap-1.5 p-0" style={{ margin: 0 }}>
              {syncResult.errors.map((err, i) => (
                <li
                  key={i}
                  style={{ font: "var(--type-body2)", color: "var(--text-error)", textWrap: "pretty" }}
                >
                  {err}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
