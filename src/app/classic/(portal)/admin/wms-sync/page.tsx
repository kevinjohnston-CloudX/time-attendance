import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getWmsSyncStatus, type BridgeHealth } from "@/actions/sync.actions";
import { format } from "date-fns";

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

const DOT: Record<BridgeHealth, string> = {
  HEALTHY: "bg-emerald-500",
  SLOW: "bg-amber-500",
  STALE: "bg-red-500",
  NEVER: "bg-zinc-300 dark:bg-zinc-600",
};

const HEALTH_NOTE: Record<BridgeHealth, string> = {
  HEALTHY: "Checking in normally.",
  SLOW: "Last check-in is overdue. Jobs are waiting, not failing.",
  STALE: "The bridge has not checked in. Nothing is syncing — check the scheduled task on the VM.",
  NEVER:
    "This bridge has never checked in. Either it is not installed yet, or BRIDGE_SECRET does not match and it is being refused.",
};

const RUN_STATUS_CLASS: Record<string, string> = {
  SUCCEEDED: "text-emerald-600 dark:text-emerald-400",
  PARTIAL: "text-amber-600 dark:text-amber-400",
  FAILED: "text-red-600 dark:text-red-400",
  RUNNING: "text-zinc-500",
};

export default async function WmsSyncPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "EMPLOYEE_MANAGE"))) redirect("/admin");

  const result = await getWmsSyncStatus(undefined);
  if (!result.success) redirect("/admin");
  const s = result.data;

  return (
    <div>
      <Link href="/admin" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Admin
      </Link>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">WMS Sync</h1>
        <p className="text-sm text-zinc-400">{s.agentName}</p>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
        Employee, schedule and gate data is read out of the WMS Oracle database by a small service
        running on the warehouse VM. It calls out to CloudTime on its own cadence — nothing here
        can reach into that network — so a job nobody collects waits rather than failing.
      </p>

      {/* Bridge health */}
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-2 font-medium text-zinc-800 dark:text-zinc-200">
            <span className={`h-2.5 w-2.5 rounded-full ${DOT[s.health]}`} />
            Bridge
          </span>
          <span className="text-zinc-500 dark:text-zinc-400">Last check-in: {ago(s.lastSeenAt)}</span>
          <span className="text-zinc-500 dark:text-zinc-400">Waiting: {s.pending}</span>
          <span className="text-zinc-500 dark:text-zinc-400">Answered (7 days): {s.done7d}</span>
          {s.failed7d > 0 && (
            <span className="text-red-600 dark:text-red-400">Failed (7 days): {s.failed7d}</span>
          )}
          {s.version && <span className="text-zinc-400">v{s.version}</span>}
        </div>
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">{HEALTH_NOTE[s.health]}</p>
      </div>

      {/* Per-leg status */}
      <h2 className="mt-8 text-sm font-semibold text-zinc-900 dark:text-white">Last run of each leg</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Shown separately because they fail independently — schedules can stop flowing while the
        roster keeps arriving.
      </p>
      <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-800/50">
            <tr>
              <th className="px-4 py-2 font-medium">Leg</th>
              <th className="px-4 py-2 font-medium">Last run</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Received</th>
              <th className="px-4 py-2 text-right font-medium">Applied</th>
              <th className="px-4 py-2 text-right font-medium">Skipped</th>
              <th className="px-4 py-2 text-right font-medium">Rejected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {s.kinds.map((k) => (
              <tr key={k.kind}>
                <td className="px-4 py-2">
                  <span className="font-medium text-zinc-900 dark:text-white">{k.label}</span>
                  <span className="ml-2 text-xs text-zinc-400">{k.cadence}</span>
                </td>
                <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{ago(k.lastRunAt)}</td>
                <td className={`px-4 py-2 ${k.status ? RUN_STATUS_CLASS[k.status] ?? "" : "text-zinc-400"}`}>
                  {k.status ?? "never run"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{k.received}</td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{k.applied}</td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-400">{k.skipped}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${k.rejected > 0 ? "text-amber-600 dark:text-amber-400" : "text-zinc-400"}`}>
                  {k.rejected}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The two human queues */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{s.candidates}</p>
          <p className="mt-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Oracle employees with no CloudTime record
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            The sync will not invent these — an employee needs a site, department and rule set, and
            the rule set is what computes overtime. Until someone creates them, their badge is
            refused at the kiosk.
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{s.conflicts}</p>
          <p className="mt-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Schedule days awaiting a decision
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Both CloudTime and Oracle changed the same day. Nothing was overwritten and these rows
            have stopped syncing until someone says which one wins.
          </p>
        </div>
      </div>

      {/* Who is actually being hurt */}
      {s.topCandidates.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-zinc-900 dark:text-white">
            Missing employees, by refused scans
          </h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-4 py-2 font-medium">Oracle empId</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Barcode</th>
                  <th className="px-4 py-2 font-medium">Department</th>
                  <th className="px-4 py-2 text-right font-medium">Refused scans</th>
                  <th className="px-4 py-2 font-medium">First seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {s.topCandidates.map((c) => (
                  <tr key={c.oracleEmpId}>
                    <td className="px-4 py-2 font-mono text-zinc-900 dark:text-white">{c.oracleEmpId}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{c.name ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-zinc-400">{c.barcode ?? "—"}</td>
                    <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{c.departmentName ?? "—"}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${c.failedScans > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-400"}`}>
                      {c.failedScans}
                    </td>
                    <td className="px-4 py-2 text-zinc-400">{format(c.firstSeenAt, "d MMM")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Run log */}
      <h2 className="mt-8 text-sm font-semibold text-zinc-900 dark:text-white">Recent runs</h2>
      <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-800/50">
            <tr>
              <th className="px-4 py-2 font-medium">Started</th>
              <th className="px-4 py-2 font-medium">Leg</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Received</th>
              <th className="px-4 py-2 text-right font-medium">Applied</th>
              <th className="px-4 py-2 text-right font-medium">Rejected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {s.recentRuns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-zinc-400">
                  No runs yet. The bridge has not answered a job.
                </td>
              </tr>
            )}
            {s.recentRuns.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">
                  {format(r.startedAt, "d MMM HH:mm")}
                </td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{r.kind}</td>
                <td className={`px-4 py-2 ${RUN_STATUS_CLASS[r.status] ?? ""}`}>
                  {r.status}
                  {r.error && <span className="ml-2 text-xs text-red-500">{r.error.slice(0, 80)}</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{r.received}</td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{r.applied}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${r.rejected > 0 ? "text-amber-600 dark:text-amber-400" : "text-zinc-400"}`}>
                  {r.rejected}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
