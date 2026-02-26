import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getEmployeeById, getAdminRefData } from "@/actions/admin.actions";
import { EditEmployeeForm } from "@/components/admin/edit-employee-form";
import { LeaveBalancesPanel } from "@/components/admin/leave-balances-panel";
import { db } from "@/lib/db";
import { format } from "date-fns";

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "EMPLOYEE_MANAGE")) redirect("/admin");

  const year = new Date().getFullYear();

  const [empResult, refResult, leaveTypes, leaveBalanceRows] = await Promise.all([
    getEmployeeById({ employeeId: id }),
    getAdminRefData(),
    db.leaveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.leaveBalance.findMany({ where: { employeeId: id, accrualYear: year } }),
  ]);

  if (!empResult.success) notFound();
  if (!refResult.success) redirect("/admin/employees");

  const employee = empResult.data;
  const { sites, departments, ruleSets, employees } = refResult.data;
  const balances = leaveTypes.map((lt) => {
    const bal = leaveBalanceRows.find((b) => b.leaveTypeId === lt.id);
    return {
      leaveTypeId: lt.id,
      leaveTypeName: lt.name,
      category: lt.category as string,
      balanceMinutes: bal?.balanceMinutes ?? 0,
      usedMinutes: bal?.usedMinutes ?? 0,
      annualDaysEntitled: bal?.annualDaysEntitled ?? null,
      year,
    };
  });

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
      </div>

      <EditEmployeeForm
        employee={employee}
        sites={sites}
        departments={departments}
        ruleSets={ruleSets}
        employees={employees}
      />

      {/* Leave Balances */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
          Leave Balances — {year}
        </h2>
        <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <LeaveBalancesPanel
            employeeId={employee.id}
            balances={balances}
            year={year}
          />
        </div>
      </div>
    </div>
  );
}
