import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getTeamQueues } from "@/lib/team/team-overview";
import { Card } from "@/components/ui";
import { WorkQueueList, workQueueRows } from "@/components/supervisor/work-queue";

/**
 * Approvals: everything waiting on this person's decision, on one screen. The
 * phone's bottom bar opens it; on a computer it is the same list Team Overview
 * leads with.
 *
 * <p>Who sees what is Team Overview's rule, through the same queries and the
 * same rows: a supervisor counts their own team, payroll and HR count every
 * team and make the HR decision. Somebody with no team to approve for is sent
 * to their dashboard, as Team Overview does.
 */
export default async function ApprovalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "TIMESHEET_APPROVE_TEAM"))) redirect("/dashboard");

  const tenantId = (session.user as { tenantId?: string }).tenantId;
  if (!tenantId) redirect("/dashboard");
  const isPayroll = ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"].includes(session.user.role);

  const queues = await getTeamQueues(tenantId, session.user.employeeId ?? null, isPayroll, new Date());
  const rows = workQueueRows(queues, isPayroll);
  const waiting = rows.filter((r) => r.actionable).reduce((n, r) => n + r.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="ta-pin ta-canvas sticky top-0 z-20 flex flex-col gap-0.5 pb-3">
        <h1 style={{ margin: 0, font: "var(--type-h1)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          Approvals
        </h1>
        <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
          {waiting === 0
            ? "Nothing is waiting on you"
            : `${waiting.toLocaleString()} ${waiting === 1 ? "item" : "items"} waiting on ${isPayroll ? "payroll and HR" : "you"}`}
        </p>
      </div>
      <Card padding={0}>
        <WorkQueueList rows={rows} />
      </Card>
    </div>
  );
}
