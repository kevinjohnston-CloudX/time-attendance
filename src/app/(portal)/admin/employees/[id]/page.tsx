import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getEmployeeById, getAdminRefData, getEmployeeAuditLogs } from "@/actions/admin.actions";
import { EditEmployeeForm } from "@/components/admin/edit-employee-form";
import { format } from "date-fns";

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "EMPLOYEE_MANAGE")) redirect("/admin");

  const [empResult, refResult, logsResult] = await Promise.all([
    getEmployeeById({ employeeId: id }),
    getAdminRefData(),
    getEmployeeAuditLogs({ employeeId: id }),
  ]);

  if (!empResult.success) notFound();
  if (!refResult.success) redirect("/admin/employees");

  const logs = logsResult.success ? logsResult.data : [];
  const employee = empResult.data;
  const { sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes } = refResult.data;

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/employees"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Employees
      </Link>

      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            {employee.user.name}
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            @{employee.user.username} · Code: {employee.employeeCode} · Hired{" "}
            {format(employee.hireDate, "MMM d, yyyy")}
          </p>
        </div>
        <Link
          href={`/admin/accruals/${id}`}
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          View Accruals
        </Link>
      </div>

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
      />
    </div>
  );
}
