import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getDataSourceDefinitions, getFilterOptions } from "@/actions/report.actions";
import { ReportBuilder } from "@/components/reports/report-builder/report-builder";

export default async function NewReportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "REPORT_MANAGE")) redirect("/dashboard");

  const [dsResult, filterResult] = await Promise.all([
    getDataSourceDefinitions(undefined as never),
    getFilterOptions(undefined as never),
  ]);

  if (!dsResult.success || !filterResult.success) {
    return <div className="text-red-600">Failed to load report configuration.</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-zinc-900 dark:text-white">
        New Report
      </h1>
      <ReportBuilder
        dataSources={dsResult.data}
        filterOptions={filterResult.data}
      />
    </div>
  );
}
