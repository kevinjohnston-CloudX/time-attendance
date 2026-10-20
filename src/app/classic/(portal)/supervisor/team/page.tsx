import Link from "next/link";
import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { loadTeamMembers, type TeamMembersParams } from "@/lib/team-members/team-members-data";

const STATUS_CLASS: Record<string, string> = {
  Active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "On leave": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Inactive: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

/**
 * Team Members, Classic: the people this viewer may see, read only (View
 * team employees). The same loader as the new design's; the search is a
 * plain form, so the page needs no script.
 */
export default async function TeamMembersPage({ searchParams }: { searchParams: Promise<TeamMembersParams> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [canView, canManage] = await Promise.all([
    userHasPermission(session.user, "EMPLOYEE_VIEW_TEAM"),
    userHasPermission(session.user, "EMPLOYEE_MANAGE"),
  ]);
  if (!canView && !canManage) redirect("/dashboard");

  const [data, ...timecardRights] = await Promise.all([
    loadTeamMembers(session.user as { employeeId?: string | null; tenantId?: string | null; role: string }, await searchParams),
    userHasPermission(session.user, "TIMECARD_VIEW_TEAM"),
    userHasPermission(session.user, "TIMECARD_VIEW_ANY"),
    userHasPermission(session.user, "TIMECARD_EDIT_TEAM"),
    userHasPermission(session.user, "TIMECARD_EDIT_ANY"),
  ]);
  const canViewTimecards = timecardRights.some(Boolean);

  const showHref = (show?: string) => {
    const params = new URLSearchParams();
    if (data.search) params.set("q", data.search);
    if (show) params.set("show", show);
    const qs = params.toString();
    return `/supervisor/team${qs ? `?${qs}` : ""}`;
  };
  const shown = data.members.length;
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1 text-xs font-medium ${
      active
        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
        : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
    }`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Team Members</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Your people&apos;s details, read only</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form method="get" action="/supervisor/team" className="flex items-center gap-2">
          {data.showInactive && <input type="hidden" name="show" value="all" />}
          <input
            type="search"
            name="q"
            defaultValue={data.search}
            placeholder="Name or badge ID"
            autoComplete="off"
            className="w-64 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Search
          </button>
        </form>
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          <Link href={showHref()} className={tab(!data.showInactive)}>Active</Link>
          <Link href={showHref("all")} className={tab(data.showInactive)}>Include inactive</Link>
        </div>
        <span className="ml-auto text-xs text-zinc-500">
          {data.total > shown
            ? `Showing the first ${shown} of ${data.total}. Search by name or badge ID to find someone.`
            : `${data.total} ${data.total === 1 ? "person" : "people"}`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {shown === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-400">
            {data.search ? "No one matches that search." : "No employees are assigned to you yet."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">
              <tr>
                <th className="px-4 py-2">Employee</th>
                <th className="px-3 py-2">Badge ID</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Job title</th>
                <th className="px-3 py-2">Agency</th>
                <th className="px-3 py-2">Supervisor</th>
                <th className="px-3 py-2">Shift</th>
                <th className="px-3 py-2">Hire date</th>
                {canViewTimecards && <th className="px-3 py-2" aria-label="Timecard" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.members.map((m) => (
                <tr key={m.id} className="text-zinc-700 dark:text-zinc-300">
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-white">{m.name}</td>
                  <td className="px-3 py-2 tabular-nums">{m.badge}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[m.status]}`}>{m.status}</span>
                  </td>
                  <td className="px-3 py-2">{m.site}</td>
                  <td className="px-3 py-2">{m.department}</td>
                  <td className="px-3 py-2">{m.jobTitle ?? "—"}</td>
                  <td className="px-3 py-2">{m.agency ?? "—"}</td>
                  <td className="px-3 py-2">{m.supervisor ?? "—"}</td>
                  <td className="px-3 py-2">{m.shift ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{format(parseISO(m.hireDate), "MMM d, yyyy")}</td>
                  {canViewTimecards && (
                    <td className="px-3 py-2 text-right">
                      <Link href={`/payroll/timecards?employeeId=${m.id}`} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                        Timecard
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
