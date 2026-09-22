import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Banner, LinkButton, PageHeader } from "@/components/ui";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getDataSourceDefinitions, getFilterOptions } from "@/actions/report.actions";
import { ReportBuilder } from "@/components/reports/report-builder/report-builder";

/**
 * The report builder route.
 *
 * <p>The page header lives inside {@link ReportBuilder} rather than here: its
 * actions are Preview and Save, and both act on state that only exists in the
 * client component. A header rendered here would either duplicate that one or
 * carry buttons it cannot wire up.
 */
export default async function NewReportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "REPORT_MANAGE")) redirect("/dashboard");

  const [dsResult, filterResult] = await Promise.all([
    getDataSourceDefinitions(undefined as never),
    getFilterOptions(undefined as never),
  ]);

  if (!dsResult.success || !filterResult.success) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="New Report" subtitle="Pick a data source, shape the columns, schedule delivery" />
        <Banner
          tone="error"
          title="The builder could not be loaded"
          body="The data sources and filter options this form is built from did not load. Nothing has been saved."
          actions={
            <LinkButton href="/reports" size="sm">
              Back to Reports
            </LinkButton>
          }
        />
      </div>
    );
  }

  return <ReportBuilder dataSources={dsResult.data} filterOptions={filterResult.data} />;
}
