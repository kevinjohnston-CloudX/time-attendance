import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getMyReports, getMyFolders } from "@/actions/report.actions";
import { Plus, FileText } from "lucide-react";
import { ReportsDashboard } from "@/components/reports/reports-dashboard";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "REPORT_MANAGE")) redirect("/dashboard");

  const [reportsResult, foldersResult] = await Promise.all([
    getMyReports(undefined as never),
    getMyFolders(undefined as never),
  ]);

  const reports = reportsResult.success
    ? reportsResult.data
    : { owned: [], shared: [], tenantWide: [] };

  const folders = foldersResult.success ? foldersResult.data : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          Reports
        </h1>
        <Link
          href="/reports/new"
          className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Plus className="h-4 w-4" />
          New Report
        </Link>
      </div>

      <ReportsDashboard reports={reports} folders={folders} />
    </div>
  );
}
