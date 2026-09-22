import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getEmployeeById, getAdminRefData, getEmployeeAuditLogs, getHrSiteAccess } from "@/actions/admin.actions";
import { EditEmployeeForm } from "@/components/admin/edit-employee-form";
import { LinkButton, PageHeader } from "@/components/ui";

/**
 * One employee, on the design's doc template: a header with the way back and
 * the related screen, then a single column of sections.
 *
 * <p>There is no page-level "Save Changes". The record is written by three
 * different calls — assignment, personal details and pay each go up on their
 * own — and one header button could only ever fire one of them. Each section
 * carries the save that belongs to it, so the button you press is next to the
 * fields it writes.
 */
export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "EMPLOYEE_MANAGE")) redirect("/admin");

  const [empResult, refResult, logsResult, siteAccessResult] = await Promise.all([
    getEmployeeById({ employeeId: id }),
    getAdminRefData(),
    getEmployeeAuditLogs({ employeeId: id }),
    getHrSiteAccess({ employeeId: id }),
  ]);

  if (!empResult.success) notFound();
  if (!refResult.success) redirect("/admin/employees");

  const logs = logsResult.success ? logsResult.data : [];
  const employee = empResult.data;
  const hrSiteAccess = siteAccessResult.success ? siteAccessResult.data : [];
  const actorRole = session.user.role;
  const { sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes } = refResult.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={employee.user.name}
        subtitle={`${employee.employeeCode} · ${employee.department.name} · ${employee.site.name}`}
        actions={
          <>
            <LinkButton href="/admin/employees" hierarchy="tertiary">
              ← Employees
            </LinkButton>
            <LinkButton href={`/admin/accruals/${id}`} hierarchy="secondary">
              View Accruals
            </LinkButton>
          </>
        }
      />

      <EditEmployeeForm
        employee={employee}
        sites={sites}
        departments={departments}
        ruleSets={ruleSets}
        employees={employees}
        customRoles={customRoles}
        shifts={shifts}
        holidayRules={holidayRules}
        payCategories={payCategories ?? []}
        payTypes={payTypes ?? []}
        logs={logs}
        hrSiteAccess={hrSiteAccess}
        actorRole={actorRole ?? "EMPLOYEE"}
      />
    </div>
  );
}
