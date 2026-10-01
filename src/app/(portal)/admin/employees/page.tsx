import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { LinkButton } from "@/components/ui";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getEmployees, getAdminRefData, getEmployeeById } from "@/actions/admin.actions";
import { CreateEmployeeForm } from "@/components/admin/create-employee-form";
import { toCopyFromEmployee } from "@/lib/employee-copy";
import { CsvUploadForm } from "@/components/admin/csv-upload-form";
import { EmployeesTable } from "@/components/admin/employees-table";
import { LIST_COOKIE } from "@/components/admin/employees-list-cookie";
import { LIST_KEYS, MISSING_OPTIONS, PAY_OPTIONS, SORT_OPTIONS, STATUS_OPTIONS, pick } from "@/components/admin/employees-list-options";
import { ArrowLeft, RefreshCw } from "lucide-react";

/**
 * Employees, on the portal design's list template.
 *
 * <p>The header carries the four actions the design gives this screen, in its
 * order: back to the hub, Import CSV, Sync ADP, Add Employee. Sync ADP is a
 * link to the ADP screen rather than a button that starts a sync — that screen
 * is where the sync is configured and where its last result is shown, and a
 * one-click sync from a list is how 214 records get overwritten by accident.
 *
 * <p>The design's All / Active / Terminated view tabs are a Status filter
 * pill instead, filtered in the query like the others so the count always
 * describes the filter. With no sort picked, active people come first, since
 * most records on file belong to people who have left.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams?: Promise<Partial<Record<(typeof LIST_KEYS)[number] | "copyFrom", string>>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "EMPLOYEE_MANAGE")) redirect("/admin");

  const sp = await searchParams;

  // Opened bare, the list comes back as it was last left in this session:
  // the search, filters and page the list itself remembered (see
  // rememberList). Only known keys are carried over.
  if (!sp || Object.values(sp).every((v) => !v)) {
    const saved = (await cookies()).get(LIST_COOKIE)?.value;
    if (saved) {
      const from = new URLSearchParams(saved);
      const to = new URLSearchParams();
      for (const k of LIST_KEYS) {
        const val = from.get(k);
        if (val) to.set(k, val);
      }
      if (to.toString()) redirect(`/admin/employees?${to.toString()}`);
    }
  }
  const page = Math.max(0, Number(sp?.page ?? 0));
  const q    = sp?.q    ?? "";
  const site = sp?.site ?? "";
  const dept = sp?.dept ?? "";
  const role = sp?.role ?? "";
  const shift = sp?.shift ?? "";
  const status = pick(STATUS_OPTIONS, sp?.status);
  const pay = pick(PAY_OPTIONS, sp?.pay);
  const missing = pick(MISSING_OPTIONS, sp?.missing);
  const sort = pick(SORT_OPTIONS, sp?.sort);

  const copyFromId = sp?.copyFrom ?? "";

  const [employeesResult, refDataResult, copySourceResult] = await Promise.all([
    getEmployees({
      page, q: q || undefined, site: site || undefined, dept: dept || undefined, role: role || undefined,
      status, shift: shift || undefined, pay, missing, sort,
    }),
    getAdminRefData(),
    copyFromId ? getEmployeeById({ employeeId: copyFromId }) : Promise.resolve(null),
  ]);

  if (!employeesResult.success || !refDataResult.success) redirect("/admin");

  const { employees, total, pageSize } = employeesResult.data;
  const { sites, departments, ruleSets, employees: allEmps, customRoles, shifts, holidayRules, payCategories, payTypes, jobTitles, agencies } = refDataResult.data;

  const copyFrom = toCopyFromEmployee(copySourceResult?.success ? copySourceResult.data : null, sites, customRoles);

  return (
    <div className="flex flex-col gap-4">
      <EmployeesTable
        title="Employees"
        subtitle="Profiles, badge numbers, assignments and pay"
        actions={
              <>
                <LinkButton
                  href="/admin"
                  hierarchy="tertiary"
                  leadingIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
                >
                  Administration
                </LinkButton>
                <CsvUploadForm
                  sites={sites.map((s) => s.name)}
                  departments={departments.map((d) => d.name)}
                  ruleSets={ruleSets.map((r) => r.name)}
                />
                <LinkButton
                  href="/admin/adp"
                  hierarchy="secondary"
                  leadingIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                >
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
                  jobTitles={jobTitles ?? []}
                  agencies={agencies ?? []}
                  copyFrom={copyFrom}
                  key={copyFrom ? `copy-${copyFromId}` : "new"}
                />
              </>
        }
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
        currentFilters={{ q, site, dept, role, status, shift, pay, missing, sort }}
      />
    </div>
  );
}
