import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getMyReports, getMyFolders } from "@/actions/report.actions";
import { Plus } from "lucide-react";
import { ReportsList } from "@/components/reports/reports-list";
import { LinkButton, PageHeader } from "@/components/ui";

/**
 * Reports, as the portal design's list screen.
 *
 * <p>What you can see is still decided entirely by `getMyReports`, which is
 * permission-scoped and returns your own reports, the ones shared with you and
 * the ones published to the tenant. The search, type, year and folder below
 * narrow those rows. They never widen them, and no tab re-queries.
 *
 * <p>All four live in the query string rather than in React state: a narrowed
 * list of reports is something one person sends another, and the previous
 * folder filter was lost on every reload.
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

  const reports = reportsResult.success
    ? reportsResult.data
    : { owned: [], shared: [], tenantWide: [] };

  const folders = foldersResult.success ? foldersResult.data : [];

  const sp = (await searchParams) ?? {};

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Reports"
        subtitle="Saved and scheduled payroll reports"
        actions={
          <LinkButton href="/reports/new" hierarchy="primary" leadingIcon={<Plus className="h-4 w-4" />}>
            New Report
          </LinkButton>
        }
      />

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
