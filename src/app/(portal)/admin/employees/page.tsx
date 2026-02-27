import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getEmployees, getAdminRefData } from "@/actions/admin.actions";
import { CreateEmployeeForm } from "@/components/admin/create-employee-form";
import { CsvUploadForm } from "@/components/admin/csv-upload-form";
import { EmployeesTable } from "@/components/admin/employees-table";

export default async function EmployeesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "EMPLOYEE_MANAGE")) redirect("/admin");

  const [employeesResult, refDataResult] = await Promise.all([
    getEmployees(),
    getAdminRefData(),
  ]);

  if (!employeesResult.success || !refDataResult.success) redirect("/admin");

  const employees = employeesResult.data;
  const { sites, departments, ruleSets, employees: allEmps } = refDataResult.data;

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
          />
        </div>
      </div>

      <EmployeesTable employees={employees} />
    </div>
  );
}
