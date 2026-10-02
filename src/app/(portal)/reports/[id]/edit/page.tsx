import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Banner, LinkButton, PageHeader } from "@/components/ui";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getDataSourceDefinitions, getFilterOptions, getReport } from "@/actions/report.actions";
import { ReportBuilder, type EditingReport } from "@/components/reports/report-builder/report-builder";
import type { DataSourceId } from "@/lib/validators/report.schema";

/**
 * Editing a saved report: the report builder, started from what was saved.
 *
 * <p>Only the person who made the report edits it. Anyone else, including
 * someone it is shared with for editing, goes back to the report, which is
 * also where a template goes; `updateReport` refuses them all the same.
 */
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

  // Not found and not yours read the same on the report page, so it says it.
  if (!reportResult.success) redirect(`/reports/${id}`);
  const report = reportResult.data;
  if (!report.access.isOwner || report.isTemplate) redirect(`/reports/${id}`);

  if (!dsResult.success || !filterResult.success) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader pinned title={`Edit ${report.name}`} />
        <Banner
          tone="error"
          title="This page could not be loaded"
          body="The report types and the lists of sites and departments did not load. Nothing was changed. Reload the page to try again."
          actions={
            <LinkButton href={`/reports/${id}`} size="sm">
              Back to the report
            </LinkButton>
          }
        />
      </div>
    );
  }

  const source = dsResult.data.find((ds) => ds.id === report.dataSource)?.id as DataSourceId | undefined;
  if (!source) redirect(`/reports/${id}`);

  const editing: EditingReport = {
    id: report.id,
    name: report.name,
    description: report.description,
    config: report.config && typeof report.config === "object" ? (report.config as EditingReport["config"]) : {},
  };

  return (
    <ReportBuilder
      dataSources={dsResult.data}
      filterOptions={filterResult.data}
      initialSource={source}
      editing={editing}
    />
  );
}
