import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LinkButton, PageHeader } from "@/components/ui";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getEmployees, getAdminRefData } from "@/actions/admin.actions";
import { CreateEmployeeForm } from "@/components/admin/create-employee-form";
import { CsvUploadForm } from "@/components/admin/csv-upload-form";
import { EmployeesTable } from "@/components/admin/employees-table";

/**
 * Employees, on the portal design's list template.
 *
 * <p>The header carries the four actions the design gives this screen, in its
 * order: back to the hub, Import CSV, Sync ADP, Add Employee. Sync ADP is a
 * link to the ADP screen rather than a button that starts a sync — that screen
 * is where the sync is configured and where its last result is shown, and a
 * one-click sync from a list is how 214 records get overwritten by accident.
 *
 * <p>The design's All / Active / Terminated view tabs are **not** here.
 * `getEmployees` filters on site, department, role and a search term and
 * nothing else, so an "Active" tab could only hide inactive rows from the one
 * page already fetched. The record count would then describe the fetch rather
 * than the filter, which on a 100-row page with 800 behind it is worse than no
 * tab at all.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; q?: string; site?: string; dept?: string; role?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "EMPLOYEE_MANAGE")) redirect("/admin");

  const sp = await searchParams;
  const page = Math.max(0, Number(sp?.page ?? 0));
  const q    = sp?.q    ?? "";
  const site = sp?.site ?? "";
  const dept = sp?.dept ?? "";
  const role = sp?.role ?? "";

  const [employeesResult, refDataResult] = await Promise.all([
    getEmployees({ page, q: q || undefined, site: site || undefined, dept: dept || undefined, role: role || undefined }),
    getAdminRefData(),
  ]);

  if (!employeesResult.success || !refDataResult.success) redirect("/admin");

  const { employees, total, pageSize } = employeesResult.data;
  const { sites, departments, ruleSets, employees: allEmps, customRoles, shifts, holidayRules, payCategories, payTypes } = refDataResult.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Employees"
        subtitle="Profiles, badge numbers, assignments and pay"
        actions={
          <>
            <LinkButton href="/admin" hierarchy="tertiary">
              ← Administration
            </LinkButton>
            <CsvUploadForm
              sites={sites.map((s) => s.name)}
              departments={departments.map((d) => d.name)}
              ruleSets={ruleSets.map((r) => r.name)}
            />
            <LinkButton href="/admin/adp" hierarchy="secondary">
              Sync ADP
            </LinkButton>
            <CreateEmployeeForm
              sites={sites}
              departments={departments}
              ruleSets={ruleSets}
              employees={allEmps}
              customRoles={customRoles}
              shifts={shifts}
              holidayRules={holidayRules}
              payCategories={payCategories ?? []}
              payTypes={payTypes ?? []}
            />
          </>
        }
      />

      <EmployeesTable
        employees={employees}
        total={total}
        page={page}
        pageSize={pageSize}
        sites={[...new Set(sites.map((s) => s.name))].sort()}
        departments={[...new Set(departments.map((d) => d.name))].sort()}
        // The shift column is a lookup against reference data this page already
        // loads for the create form, not a second read — `getEmployees` returns
        // shiftId but does not join the shift, and widening that join would be
        // a query change.
        shifts={shifts}
        currentFilters={{ q, site, dept, role }}
      />
    </div>
  );
}
