import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getAuditLogs } from "@/actions/admin.actions";
import { format } from "date-fns";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; entityType?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "AUDIT_VIEW")) redirect("/admin");

  const page = Number(sp.page ?? 1);
  const entityType = sp.entityType;

  const result = await getAuditLogs({ page, entityType });
  if (!result.success) redirect("/admin");

  const { logs, total, pages } = result.data;

  const ENTITY_TYPES = [
    "USER","EMPLOYEE","PUNCH","TIMESHEET","PAY_PERIOD","LEAVE_REQUEST","LEAVE_BALANCE","RULE_SET","DOCUMENT"
  ];

  return (
    <div>
      <Link href="/admin" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Admin
      </Link>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Audit Log</h1>
        <p className="text-sm text-zinc-400">{total} entries</p>
      </div>

      {/* Filter */}
      <form method="GET" className="mt-4 flex items-center gap-3">
        <select
          name="entityType"
          defaultValue={entityType ?? ""}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="">All types</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300"
        >
          Filter
        </button>
        {entityType && (
          <Link
            href="/admin/audit"
            className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Log table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">When</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Actor</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Action</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Entity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-400">
                  No audit entries found.
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-400">
                  {format(log.createdAt, "MMM d, yyyy HH:mm:ss")}
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {log.actor?.user?.name ?? log.actorId ?? "System"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  {log.action}
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                    {log.entityType}
                  </span>
                  <span className="ml-1 font-mono text-zinc-400">
                    {log.entityId.slice(0, 8)}…
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="mt-4 flex items-center gap-2">
          {page > 1 && (
            <Link
              href={`/admin/audit?page=${page - 1}${entityType ? `&entityType=${entityType}` : ""}`}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300"
            >
              ← Prev
            </Link>
          )}
          <span className="text-sm text-zinc-400">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link
              href={`/admin/audit?page=${page + 1}${entityType ? `&entityType=${entityType}` : ""}`}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
