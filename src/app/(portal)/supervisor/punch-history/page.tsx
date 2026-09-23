import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { loadTeamPunchHistory, type PunchHistoryParams } from "@/lib/punch-history/punch-history-data";
import { TeamPunchHistoryViewer } from "@/components/supervisor/team-punch-history-viewer";
import { PageHeader } from "@/components/ui";

/**
 * Team Punch History.
 *
 * <p>The permission check is here; who may be seen, the date range and every
 * number on the screen are in the loader, which the export reads too.
 */
export default async function TeamPunchHistoryPage({
  searchParams,
}: {
  searchParams: Promise<PunchHistoryParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PUNCH_VIEW_TEAM")) redirect("/dashboard");

  const data = await loadTeamPunchHistory(session.user, await searchParams);

  const scopeLabel = data.isPayroll
    ? `${data.scopedTotal} employee${data.scopedTotal === 1 ? "" : "s"}`
    : `${data.scopedTotal} direct report${data.scopedTotal === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Team Punch History"
        subtitle={`${scopeLabel} · every punch, where it came from and whether it has been approved`}
      />
      <TeamPunchHistoryViewer
        employees={data.employees}
        selectedEmployeeId={data.selected?.id ?? null}
        punches={data.punches.map((p) => ({
          id: p.id,
          punchTime: p.punchTime,
          roundedTime: p.roundedTime,
          punchType: p.punchType,
          source: p.source,
          isApproved: p.isApproved,
          correctedById: p.isSuperseded ? p.id : null,
          correctsId: p.isCorrection ? p.id : null,
        }))}
        startDate={data.startDate}
        endDate={data.endDate}
        isCustomRange={data.isCustomRange}
        isPayroll={data.isPayroll}
        sites={data.sites}
        selectedSiteId={data.selectedSiteId}
        departments={data.departments}
        selectedDepartmentId={data.selectedDepartmentId}
      />
    </div>
  );
}
