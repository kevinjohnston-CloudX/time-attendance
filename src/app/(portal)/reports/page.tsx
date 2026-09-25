import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getMyReports, getMyFolders } from "@/actions/report.actions";
import { Plus } from "lucide-react";
import { ReportsList, type ReportRow } from "@/components/reports/reports-list";
import { Banner, LinkButton, PageHeader } from "@/components/ui";

/**
 * Reports: the six standard reports to start from, then the saved ones.
 *
 * <p>What you can see is still decided entirely by `getMyReports`, which is
 * permission scoped and returns your own reports, the ones shared with you and
 * the ones published to everyone. The search, type, year and folder narrow
 * those rows in the list below. They never widen them.
 *
 * <p>Rows go to the list trimmed to what it draws, so a report's saved
 * configuration never travels to the browser just to print its name.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; year?: string; folder?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "REPORT_MANAGE")) redirect("/dashboard");

  const [reportsResult, foldersResult] = await Promise.all([
    getMyReports(undefined as never),
    getMyFolders(undefined as never),
  ]);

  type Row = {
    id: string;
    name: string;
    description: string | null;
    dataSource: string;
    updatedAt: Date;
    folderId: string | null;
    owner: { name: string | null } | null;
    _count: { runs: number };
  };
  const trim = (r: Row): ReportRow => ({
    id: r.id,
    name: r.name,
    description: r.description,
    dataSource: r.dataSource,
    updatedAt: r.updatedAt.toISOString(),
    folderId: r.folderId,
    ownerName: r.owner?.name ?? null,
    runs: r._count.runs,
  });

  const reports = reportsResult.success
    ? {
        owned: reportsResult.data.owned.map(trim),
        shared: reportsResult.data.shared.map(trim),
        tenantWide: reportsResult.data.tenantWide.map(trim),
      }
    : { owned: [], shared: [], tenantWide: [] };

  const folders = (foldersResult.success ? foldersResult.data : []).map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    reportCount: f._count.reports,
    children: f.children.map((c) => ({ id: c.id, name: c.name })),
  }));

  const sp = (await searchParams) ?? {};

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned
        title="Reports"
        subtitle="Hours, attendance, exceptions and time off, ready to run or saved your way"
        actions={
          <LinkButton href="/reports/new" hierarchy="primary" leadingIcon={<Plus className="h-4 w-4" />}>
            New report
          </LinkButton>
        }
      />

      {!reportsResult.success && (
        <Banner
          tone="error"
          title="Saved reports could not be loaded"
          body="The standard reports still work. Reload the page to try the saved ones again."
        />
      )}

      <ReportsList
        reports={reports}
        folders={folders}
        q={sp.q ?? ""}
        type={sp.type ?? ""}
        year={sp.year ?? ""}
        folder={sp.folder ?? ""}
      />
    </div>
  );
}
