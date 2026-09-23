import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getWmsSyncStatus, type BridgeHealth } from "@/actions/sync.actions";
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  StatCard,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  statusTone,
  type BadgeTone,
  type BannerTone,
} from "@/components/ui";
import { PlugZap } from "lucide-react";
import { SyncNowButton } from "./SyncNowButton";
import { format } from "date-fns";
import type { ReactNode } from "react";

/**
 * WMS Sync, on the portal design's doc template: the bridge's own state as a
 * banner, its figures as a key-value row, then the tables.
 *
 * <p>The design's Frequency / Scope / On Conflict settings are deliberately
 * absent — see the report. CloudTime cannot reach the VM at all; every exchange
 * is started by the bridge, so there is no cadence this page could change. That
 * is also why the banner leads with the check-in rather than with a last-run
 * time: from in here, "synced and nothing changed" and "dead since Tuesday"
 * both look like an empty queue.
 *
 * <p>"Sync now" is the one exception, and it is not a contradiction of the
 * above. It cannot start an exchange either — it puts a job in the queue the
 * bridge already polls, which removes the wait for the next cron tick but not
 * the poll itself. Without it, an employee added to a shift in Oracle simply
 * cannot badge in until the schedule pull comes round.
 */

export const dynamic = "force-dynamic";

function ago(date: Date | string | null | undefined): string {
  if (!date) return "never";
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const HEALTH: Record<BridgeHealth, { tone: BannerTone; title: string; note: string }> = {
  HEALTHY: {
    tone: "success",
    title: "Bridge is checking in",
    note: "Checking in normally.",
  },
  SLOW: {
    tone: "warning",
    title: "Bridge check-in is overdue",
    note: "Last check-in is overdue. Jobs are waiting, not failing.",
  },
  STALE: {
    tone: "error",
    title: "Bridge has stopped checking in",
    note: "The bridge has not checked in. Nothing is syncing — check the scheduled task on the VM.",
  },
  NEVER: {
    tone: "warning",
    title: "Bridge has never checked in",
    note:
      "This bridge has never checked in. Either it is not installed yet, or BRIDGE_SECRET does not match and it is being refused.",
  },
};

const RUN_STATUS_LABEL: Record<string, string> = {
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
  PARTIAL: "Partial",
  FAILED: "Failed",
};

/**
 * A sync run's outcome as a pill.
 *
 * <p>`statusTone` has no case for SUCCEEDED or RUNNING and would answer warning
 * for both — amber on a run that worked. Translating those two into the
 * canonical values the shared helper already knows keeps every pill in the
 * product coming from one place; a per-screen colour map here is exactly how
 * this codebase previously ended up with two different greens for "approved".
 * PARTIAL and FAILED fall through and land on warning and error by themselves.
 */
function runTone(status: string | null): BadgeTone {
  if (!status) return statusTone("DRAFT");
  if (status === "SUCCEEDED") return statusTone("RESOLVED");
  if (status === "RUNNING") return statusTone("IN_PROGRESS");
  return statusTone(status);
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

export default async function WmsSyncPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "EMPLOYEE_MANAGE"))) redirect("/admin");

  const result = await getWmsSyncStatus(undefined);
  if (!result.success) redirect("/admin");
  const s = result.data;

  const health = HEALTH[s.health];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned
        title="WMS Sync"
        subtitle="Roster, schedules and gate baselines, read out of the warehouse Oracle database"
        actions={
          <div className="flex items-center gap-3">
            <SyncNowButton />
            <LinkButton href="/admin" hierarchy="tertiary">
              ← Administration
            </LinkButton>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <Banner
          tone={health.tone}
          title={health.title}
          body={health.note}
          meta="A small service on the warehouse VM does the reading and calls out to CloudTime on its own cadence — nothing here can reach into that network, so a job nobody collects waits rather than failing."
        />

        <Card title="Bridge" subtitle={s.agentName}>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
            <Kv label="Last check-in" value={ago(s.lastSeenAt)} />
            <Kv label="Waiting" value={s.pending} />
            <Kv label="Answered (7 days)" value={s.done7d} />
            <Kv label="Failed (7 days)" value={s.failed7d} />
            <Kv label="Agent version" value={s.version ? `v${s.version}` : "unknown"} />
          </div>
        </Card>

        {/* The two queues a person is expected to work. Coloured only when
            there is something in them — a permanently amber zero is a number
            people stop reading. */}
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
          <StatCard
            label="Oracle employees with no CloudTime record"
            value={s.candidates}
            tone={s.candidates > 0 ? "warning" : "default"}
            sub="The sync will not invent these — an employee needs a site, department and rule set, and the rule set is what computes overtime. Until someone creates them, their badge is refused at the kiosk."
          />
          <StatCard
            label="Schedule days awaiting a decision"
            value={s.conflicts}
            tone={s.conflicts > 0 ? "warning" : "default"}
            sub="Both CloudTime and Oracle changed the same day. Nothing was overwritten and these rows have stopped syncing until someone says which one wins."
          />
        </div>

        <Card
          title="Last run of each leg"
          subtitle="Shown separately because they fail independently — schedules can stop flowing while the roster keeps arriving."
          padding={0}
        >
          <Table>
            <THead>
              <TR>
                <TH>Leg</TH>
                <TH>Cadence</TH>
                <TH>Last run</TH>
                <TH>Status</TH>
                <TH numeric>Received</TH>
                <TH numeric>Applied</TH>
                <TH numeric>Skipped</TH>
                <TH numeric>Rejected</TH>
              </TR>
            </THead>
            <TBody>
              {s.kinds.map((k) => (
                <TR key={k.kind}>
                  <TD style={{ fontWeight: "var(--weight-medium)" }}>{k.label}</TD>
                  <TD style={{ color: "var(--text-tertiary)" }}>{k.cadence}</TD>
                  <TD style={{ color: "var(--text-secondary)" }}>{ago(k.lastRunAt)}</TD>
                  <TD>
                    <Badge tone={runTone(k.status)} size="sm">
                      {k.status ? RUN_STATUS_LABEL[k.status] ?? k.status : "Never run"}
                    </Badge>
                  </TD>
                  <TD numeric style={{ color: "var(--text-secondary)" }}>{k.received}</TD>
                  <TD numeric style={{ color: "var(--text-secondary)" }}>{k.applied}</TD>
                  <TD numeric style={{ color: "var(--text-tertiary)" }}>{k.skipped}</TD>
                  <TD
                    numeric
                    style={{ color: k.rejected > 0 ? "var(--text-warning)" : "var(--text-tertiary)" }}
                  >
                    {k.rejected}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>

        {s.topCandidates.length > 0 && (
          <Card
            title="Missing employees, by refused scans"
            subtitle="Oracle knows these badges and CloudTime does not, so every scan they make is turned away."
            padding={0}
          >
            <Table>
              <THead>
                <TR>
                  <TH>Oracle empId</TH>
                  <TH>Name</TH>
                  <TH>Barcode</TH>
                  <TH>Department</TH>
                  <TH numeric>Refused scans</TH>
                  <TH>First seen</TH>
                </TR>
              </THead>
              <TBody>
                {s.topCandidates.map((c) => (
                  <TR key={c.oracleEmpId}>
                    <TD style={{ fontFamily: "var(--font-mono)" }}>{c.oracleEmpId}</TD>
                    <TD style={{ color: "var(--text-secondary)" }}>{c.name ?? "—"}</TD>
                    <TD style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                      {c.barcode ?? "—"}
                    </TD>
                    <TD style={{ color: "var(--text-tertiary)" }}>{c.departmentName ?? "—"}</TD>
                    <TD
                      numeric
                      style={{
                        color: c.failedScans > 0 ? "var(--text-error)" : "var(--text-tertiary)",
                      }}
                    >
                      {c.failedScans}
                    </TD>
                    <TD style={{ color: "var(--text-tertiary)" }}>{format(c.firstSeenAt, "d MMM")}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}

        <Card title="Recent runs" subtitle="The last ten, newest first" padding={0}>
          {s.recentRuns.length === 0 ? (
            <EmptyState
              icon={<PlugZap className="h-7 w-7" />}
              title="No runs yet"
              body="The bridge has not answered a job. Until it does there is nothing to report — which is not the same as nothing having changed in Oracle."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Started</TH>
                  <TH>Leg</TH>
                  <TH>Result</TH>
                  <TH numeric>Received</TH>
                  <TH numeric>Applied</TH>
                  <TH numeric>Rejected</TH>
                </TR>
              </THead>
              <TBody>
                {s.recentRuns.map((r) => (
                  <TR key={r.id}>
                    <TD style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                      {format(r.startedAt, "d MMM HH:mm")}
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>{r.kind}</TD>
                    <TD>
                      <span className="inline-flex items-center gap-2">
                        <Badge tone={runTone(r.status)} size="sm">
                          {RUN_STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                        {/* Truncated, and the full text is on the title: one
                            Oracle stack trace would otherwise set the width of
                            every column in this table. */}
                        {r.error && (
                          <span
                            title={r.error}
                            style={{ font: "var(--type-body2)", color: "var(--text-error)" }}
                          >
                            {r.error.slice(0, 80)}
                          </span>
                        )}
                      </span>
                    </TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>{r.received}</TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>{r.applied}</TD>
                    <TD
                      numeric
                      style={{ color: r.rejected > 0 ? "var(--text-warning)" : "var(--text-tertiary)" }}
                    >
                      {r.rejected}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
