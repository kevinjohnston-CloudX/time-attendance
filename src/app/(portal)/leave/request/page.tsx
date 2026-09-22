import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getLeaveTypes } from "@/actions/leave.actions";
import { db } from "@/lib/db";
import { RequestLeaveForm } from "@/components/leave/request-leave-form";

/**
 * Request Leave — the design's document template.
 *
 * <p>The page is the data fetch and nothing else. The header belongs to the
 * form because its primary action is the form's submit, and a header rendered
 * here could not tell whether a day had been picked yet.
 */
export default async function RequestLeavePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "LEAVE_REQUEST_OWN")) redirect("/dashboard");

  const [result, employee] = await Promise.all([
    getLeaveTypes(),
    db.employee.findFirst({
      where: { userId: session.user.id },
      select: {
        shift: { select: { startTime: true, endTime: true, workDays: true } },
        ruleSet: { select: { mealBreakMinutes: true, mealBreakAfterMinutes: true } },
      },
    }),
  ]);

  if (!result.success || result.data.length === 0) redirect("/leave");

  return (
    <RequestLeaveForm
      leaveTypes={result.data}
      shift={employee?.shift ? { ...employee.shift, ...employee.ruleSet } : null}
    />
  );
}
