import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getReport, getFilterOptions, getTenantUsers } from "@/actions/report.actions";
import { ReportViewer } from "@/components/reports/report-viewer";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "REPORT_MANAGE")) redirect("/dashboard");

  const [reportResult, filterResult, usersResult] = await Promise.all([
    getReport({ id }),
    getFilterOptions(undefined as never),
    getTenantUsers(undefined as never),
  ]);

  if (!reportResult.success) {
    return (
      <div className="text-red-600">
        Report not found or access denied.
      </div>
    );
  }

  return (
    <ReportViewer
      report={reportResult.data}
      filterOptions={filterResult.success ? filterResult.data : null}
      tenantUsers={usersResult.success ? usersResult.data : []}
    />
  );
}
