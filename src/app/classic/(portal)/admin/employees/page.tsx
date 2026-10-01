import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getEmployees, getAdminRefData, getEmployeeById } from "@/actions/admin.actions";
import { CreateEmployeeForm } from "@/classic/components/admin/create-employee-form";
import { toCopyFromEmployee } from "@/lib/employee-copy";
import { CsvUploadForm } from "@/classic/components/admin/csv-upload-form";
import { EmployeesTable } from "@/classic/components/admin/employees-table";

interface Props {
  searchParams?: Promise<{ page?: string; q?: string; site?: string; dept?: string; role?: string; inactive?: string; copyFrom?: string }>;
}

export default async function EmployeesPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "EMPLOYEE_MANAGE")) redirect("/admin");

  const sp = await searchParams;
  const page         = Math.max(0, Number(sp?.page ?? 0));
  const q            = sp?.q    ?? "";
  const site         = sp?.site ?? "";
  const dept         = sp?.dept ?? "";
  const role         = sp?.role ?? "";
  const showInactive = sp?.inactive === "1";
  const copyFromId   = sp?.copyFrom ?? "";

  const [employeesResult, refDataResult, copySourceResult] = await Promise.all([
    // The shared list opens on current employees; "Show inactive" asks it for everyone.
    getEmployees({ page, q: q || undefined, site: site || undefined, dept: dept || undefined, role: role || undefined, status: showInactive ? "all" : undefined }),
    getAdminRefData(),
    copyFromId ? getEmployeeById({ employeeId: copyFromId }) : Promise.resolve(null),
  ]);

  if (!employeesResult.success || !refDataResult.success) redirect("/admin");

  const { employees, total, pageSize } = employeesResult.data;
  const { sites, departments, ruleSets, employees: allEmps, customRoles, shifts, holidayRules, payCategories, payTypes, jobTitles, agencies } = refDataResult.data;
  const copyFrom = toCopyFromEmployee(copySourceResult?.success ? copySourceResult.data : null, sites, customRoles);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            ← Admin
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
            Employees
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <CsvUploadForm
            sites={sites.map((s) => s.name)}
            departments={departments.map((d) => d.name)}
            ruleSets={ruleSets.map((r) => r.name)}
          />
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
        </div>
      </div>

      <EmployeesTable
        employees={employees}
        total={total}
        page={page}
        pageSize={pageSize}
        sites={[...new Set(sites.map((s) => s.name))].sort()}
        departments={[...new Set(departments.map((d) => d.name))].sort()}
        currentFilters={{ q, site, dept, role, showInactive }}
      />
    </div>
  );
}
