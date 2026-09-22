import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getReport, getFilterOptions, getTenantUsers } from "@/actions/report.actions";
import { ReportViewer } from "@/components/reports/report-viewer";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { FileSearch } from "lucide-react";

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
    // Deliberately one message for both cases. The lookup is scoped to the
    // tenant, so "no such report" and "not yours" are indistinguishable here,
    // and telling the two apart would confirm to somebody that a report id
    // they cannot open exists.
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Report" subtitle="Saved and scheduled payroll reports" />
        <Card padding={0}>
          <EmptyState
            icon={<FileSearch className="h-8 w-8" />}
            title="This report is not available"
            body="It has been deleted, or it belongs to someone who has not shared it with you."
            action={
              <LinkButton href="/reports" hierarchy="primary" size="sm">
                Back to Reports
              </LinkButton>
            }
          />
        </Card>
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
