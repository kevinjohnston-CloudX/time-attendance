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
export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
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
        <PageHeader pinned title="New Report" subtitle="Pick a data source, shape the columns, schedule delivery" />
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

  // A Standard reports card opens the builder on its own report. Anything that
  // is not one of the sources on offer is ignored rather than trusted.
  const { source } = (await searchParams) ?? {};
  const initialSource = dsResult.data.find((ds) => ds.id === source)?.id ?? null;

  return <ReportBuilder dataSources={dsResult.data} filterOptions={filterResult.data} initialSource={initialSource} />;
}
