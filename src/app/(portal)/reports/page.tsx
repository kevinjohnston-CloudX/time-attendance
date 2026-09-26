import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getDataSourceDefinitions, getMyReports, getMyFolders } from "@/actions/report.actions";
import { ReportsList, type ReportRow } from "@/components/reports/reports-list";

/**
 * Reports: the reports people have saved. New report opens a window of the
 * report types; the page only offers them itself while nothing is saved yet.
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
  searchParams: Promise<{ q?: string; view?: string; type?: string; year?: string; folder?: string; new?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "REPORT_MANAGE")) redirect("/dashboard");

  const [reportsResult, foldersResult, sourcesResult] = await Promise.all([
    getMyReports(undefined as never),
    getMyFolders(undefined as never),
    getDataSourceDefinitions(undefined as never),
  ]);

  // What the New report window needs from each type to describe it: names
  // only, not the filter options, which belong to the builder.
  const sources = sourcesResult.success
    ? sourcesResult.data.map((ds) => ({
        id: ds.id,
        label: ds.label,
        description: ds.description,
        icon: ds.icon,
        columns: ds.columns.map((c) => ({ id: c.id, label: c.label, defaultVisible: c.defaultVisible })),
        filters: ds.filters.map((f) => ({ id: f.id, label: f.label })),
        groupableFields: ds.groupableFields,
      }))
    : [];

  type Row = {
    id: string;
    name: string;
    description: string | null;
    dataSource: string;
    updatedAt: Date;
    folderId: string | null;
    owner: { name: string | null } | null;
    _count: { runs: number };
    runs: { startedAt: Date }[];
    schedules: { nextRunAt: Date | null }[];
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
    lastRunAt: r.runs[0]?.startedAt.toISOString() ?? null,
    nextEmailAt: r.schedules[0]?.nextRunAt?.toISOString() ?? null,
    scheduled: r.schedules.length > 0,
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
    <ReportsList
      reports={reports}
      folders={folders}
      sources={sources}
      openNew={sp.new === "1"}
      loadFailed={!reportsResult.success}
      q={sp.q ?? ""}
      view={sp.view ?? ""}
      type={sp.type ?? ""}
      year={sp.year ?? ""}
      folder={sp.folder ?? ""}
    />
  );
}
