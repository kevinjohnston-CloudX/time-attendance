import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getEmployeeById, getAdminRefData, getEmployeeAuditLogs, getEmployeeLeaveLog } from "@/actions/admin.actions";
import { getEmployeePtoPolicyOverride, getPtoPolicies } from "@/actions/pto-policy.actions";
import { EditEmployeeForm } from "@/components/admin/edit-employee-form";
import { db } from "@/lib/db";
import { format, differenceInMonths } from "date-fns";

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "EMPLOYEE_MANAGE")) redirect("/admin");

  const year = new Date().getFullYear();

  const yearStart = new Date(`${year}-01-01T00:00:00Z`);
  const yearEnd   = new Date(`${year + 1}-01-01T00:00:00Z`);

  const [empResult, refResult, leaveTypes, leaveBalanceRows, accrualSums, approvedRequests, logsResult, leaveLogResult] = await Promise.all([
    getEmployeeById({ employeeId: id }),
    getAdminRefData(),
    db.leaveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.leaveBalance.findMany({ where: { employeeId: id, accrualYear: year } }),
    db.leaveAccrualLedger.groupBy({
      by: ["leaveTypeId"],
      where: { employeeId: id, action: "ACCRUAL", payPeriodEnd: { gte: yearStart, lt: yearEnd } },
      _sum: { deltaMinutes: true },
    }),
    db.leaveRequest.findMany({
      where: { employeeId: id, status: { in: ["APPROVED", "PENDING"] } },
      select: { leaveTypeId: true, durationMinutes: true, status: true },
    }),
    getEmployeeAuditLogs({ employeeId: id }),
    getEmployeeLeaveLog({ employeeId: id }),
  ]);

  if (!empResult.success) notFound();
  if (!refResult.success) redirect("/admin/employees");

  const logs = logsResult.success ? logsResult.data : [];
  const leaveLog = leaveLogResult.success ? leaveLogResult.data : [];

  const employee = empResult.data;
  const { sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories } = refResult.data;

  // PTO policy data
  const [overrideResult, ptoPoliciesResult] = await Promise.all([
    getEmployeePtoPolicyOverride({ employeeId: id }),
    getPtoPolicies(),
  ]);

  const ptoPolicies = ptoPoliciesResult.success
    ? ptoPoliciesResult.data.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name }))
    : [];

  const currentPolicyId = overrideResult.success && overrideResult.data
    ? overrideResult.data.ptoPolicyId
    : null;

  // Calculate policy-derived accrual rate per leave type for the employee's current tenure
  const tenureMonths = differenceInMonths(new Date(), employee.hireDate);
  const assignedPolicy = ptoPoliciesResult.success
    ? ptoPoliciesResult.data.find((p) => p.id === currentPolicyId) ?? null
    : null;

  const tenureYears = Math.floor(tenureMonths / 12);
  const policyRateByLeaveType = new Map<string, { annualHours: number; policyName: string }>();
  if (assignedPolicy) {
    for (const lt of leaveTypes) {
      const tiers = assignedPolicy.rules
        .filter((r) => r.leaveTypeId === lt.id)
        .sort((a, b) => a.minTenureMonths - b.minTenureMonths);
      const match = tiers.find(
        (t) => t.minTenureMonths <= tenureMonths && (t.maxTenureMonths === null || tenureMonths < t.maxTenureMonths)
      );
      if (match) {
        const effectiveAnnualHours = match.annualHours + tenureYears * match.earnedHoursPerYear;
        policyRateByLeaveType.set(lt.id, { annualHours: effectiveAnnualHours, policyName: assignedPolicy.name });
      }
    }
  }

  const accrualSumMap = new Map(
    accrualSums.map((s) => [s.leaveTypeId, s._sum.deltaMinutes ?? 0])
  );

  const approvedMinutesMap = new Map<string, number>();
  const pendingMinutesMap = new Map<string, number>();
  for (const r of approvedRequests) {
    if (r.status === "APPROVED") {
      approvedMinutesMap.set(r.leaveTypeId, (approvedMinutesMap.get(r.leaveTypeId) ?? 0) + r.durationMinutes);
    } else {
      pendingMinutesMap.set(r.leaveTypeId, (pendingMinutesMap.get(r.leaveTypeId) ?? 0) + r.durationMinutes);
    }
  }

  const balances = leaveTypes.map((lt) => {
    const bal = leaveBalanceRows.find((b) => b.leaveTypeId === lt.id);
    const policyRate = policyRateByLeaveType.get(lt.id) ?? null;
    return {
      leaveTypeId: lt.id,
      leaveTypeName: lt.name,
      category: lt.category as string,
      balanceMinutes: bal?.balanceMinutes ?? 0,
      usedMinutes: bal?.usedMinutes ?? 0,
      accruedMinutes: accrualSumMap.get(lt.id) ?? 0,
      approvedMinutes: approvedMinutesMap.get(lt.id) ?? 0,
      pendingMinutes: pendingMinutesMap.get(lt.id) ?? 0,
      year,
      policyAnnualHours: policyRate?.annualHours ?? null,
      policyName: policyRate?.policyName ?? null,
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
        customRoles={customRoles}
        shifts={shifts}
        holidayRules={holidayRules}
        payCategories={payCategories ?? []}
        balances={balances}
        year={year}
        ptoPolicies={ptoPolicies}
        currentPolicyId={currentPolicyId}
        logs={logs}
        leaveLog={leaveLog}
      />

    </div>
  );
}
