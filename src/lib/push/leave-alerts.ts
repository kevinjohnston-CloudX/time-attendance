import { db } from "@/lib/db";
import { hasPermissionByLegacy } from "@/lib/rbac/permission-resolver";
import { pushToUsers } from "./send";

/**
 * The three leave notifications, sent to the same people the bell already
 * counts them for (src/lib/dashboard/dashboard-data.ts):
 *
 * <p>a request submitted goes to the person's own supervisor ("Leave to
 * approve"); a request the supervisor passed on goes to everyone in the
 * company who gives the HR approval ("Leave waiting on HR"); and the final
 * approval or refusal goes to the person who asked.
 *
 * <p>Called after the change is saved, never before. Each one only ever
 * sends; a failure is logged and nothing else happens.
 */

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Someone";
}

async function requestWithOwner(leaveRequestId: string) {
  return db.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    select: {
      status: true,
      employee: {
        select: {
          id: true,
          tenantId: true,
          userId: true,
          user: { select: { name: true } },
          supervisor: { select: { userId: true, isActive: true } },
        },
      },
    },
  });
}

/** A request just went to PENDING: the person's own supervisor. */
export async function alertLeaveSubmitted(leaveRequestId: string): Promise<void> {
  const request = await requestWithOwner(leaveRequestId).catch(() => null);
  const supervisor = request?.employee.supervisor;
  if (request?.status !== "PENDING" || !supervisor?.isActive || !supervisor.userId) return;
  await pushToUsers([supervisor.userId], {
    title: "Time off request",
    body: `${firstName(request.employee.user?.name)} asked for time off. Tap to review it.`,
    href: "/supervisor/leave",
  });
}

/** A request just went to PENDING_HR: everyone in the company who gives the HR approval, but not the person who asked or who passed it on. */
export async function alertLeaveWaitingOnHr(leaveRequestId: string, actorEmployeeId: string | null): Promise<void> {
  const request = await requestWithOwner(leaveRequestId).catch(() => null);
  if (request?.status !== "PENDING_HR" || !request.employee.tenantId) return;

  const candidates = await db.employee.findMany({
    where: { tenantId: request.employee.tenantId, isActive: true, customRoleId: { not: null }, NOT: { id: { in: [request.employee.id, actorEmployeeId ?? ""] } } },
    select: { userId: true, customRoleId: true },
  });
  // One check per role, not per person: a company has a handful of roles.
  const roles = [...new Set(candidates.map((c) => c.customRoleId!))];
  const approving = new Set<string>();
  for (const role of roles) if (await hasPermissionByLegacy(role, "LEAVE_APPROVE_ANY")) approving.add(role);

  await pushToUsers(
    candidates.filter((c) => approving.has(c.customRoleId!)).map((c) => c.userId),
    {
      title: "Time off waiting on HR",
      body: `${firstName(request.employee.user?.name)}'s time off request is ready for HR approval.`,
      href: "/supervisor/leave?tab=hr-pending",
    },
  );
}

/** A request was just approved by HR or refused: the person who asked. */
export async function alertLeaveDecided(leaveRequestId: string): Promise<void> {
  const request = await requestWithOwner(leaveRequestId).catch(() => null);
  if (!request?.employee.userId) return;
  if (request.status === "APPROVED") {
    await pushToUsers([request.employee.userId], { title: "Time off approved", body: "Your time off request was approved.", href: "/leave" });
  } else if (request.status === "REJECTED") {
    await pushToUsers([request.employee.userId], {
      title: "Time off not approved",
      body: "Your time off request was not approved. Open CloudTime to see why.",
      href: "/leave",
    });
  }
}
