import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getDataSourceDefinitions, getFilterOptions, getReport } from "@/actions/report.actions";
import { ReportBuilder, type EditingReport } from "@/classic/components/reports/report-builder/report-builder";
import { classicFilterOptions } from "@/classic/lib/report-options";
import type { DataSourceId } from "@/lib/validators/report.schema";

/** Editing a saved report. Only its creator gets past the redirect; updateReport checks it again. */
export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "REPORT_MANAGE")) redirect("/dashboard");

  const [reportResult, dsResult, filterResult] = await Promise.all([
    getReport({ id }),
    getDataSourceDefinitions(undefined as never),
    getFilterOptions(undefined as never),
  ]);

  if (!reportResult.success) redirect(`/reports/${id}`);
  const report = reportResult.data;
  if (!report.access.isOwner || report.isTemplate) redirect(`/reports/${id}`);

  if (!dsResult.success || !filterResult.success) {
    return <div className="text-red-600">Failed to load report configuration.</div>;
  }

  const editing: EditingReport = {
    id: report.id,
    name: report.name,
    description: report.description,
    dataSource: report.dataSource as DataSourceId,
    config: report.config && typeof report.config === "object" ? (report.config as EditingReport["config"]) : {},
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-zinc-900 dark:text-white">Edit Report</h1>
      <ReportBuilder
        dataSources={dsResult.data}
        filterOptions={classicFilterOptions(filterResult.data)}
        editing={editing}
      />
    </div>
  );
}
