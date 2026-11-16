import { db } from "@/lib/db";
import { hrApprovers } from "@/lib/notify/approvers";
import { emailUsers, leaveDays, leaveHours, type ApprovalEmail } from "@/lib/notify/approval-email";
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
 * <p>Each one also goes out as an email, with the request's details
 * (lib/notify/approval-email.ts).
 *
 * <p>Called after the change is saved, never before. Each one only ever
 * sends; a failure is logged and nothing else happens.
 */

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Someone";
}

function fullName(name: string | null | undefined): string {
  return name?.trim() || "An employee";
}

type Request = NonNullable<Awaited<ReturnType<typeof requestWithOwner>>>;

/** The rows every time off email shows: the person (when it is not them), type, days, hours. */
function requestDetails(r: Request, withName: boolean): [string, string][] {
  const hours = leaveHours(r.durationSeconds);
  return [
    ...(withName ? ([["Employee", fullName(r.employee.user?.name)]] as [string, string][]) : []),
    ["Type", r.leaveType.name],
    ["Dates", leaveDays(r.startDate, r.endDate)],
    ...(hours ? ([["Hours", hours]] as [string, string][]) : []),
  ];
}

async function tell(userIds: string[], push: Parameters<typeof pushToUsers>[1], email: ApprovalEmail): Promise<void> {
  await Promise.all([pushToUsers(userIds, push), emailUsers(userIds, email)]);
}

async function requestWithOwner(leaveRequestId: string) {
  return db.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    select: {
      status: true,
      startDate: true,
      endDate: true,
      durationSeconds: true,
      reviewNote: true,
      leaveType: { select: { name: true } },
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
  const name = fullName(request.employee.user?.name);
  await tell(
    [supervisor.userId],
    {
      title: "Time off request",
      body: `${firstName(request.employee.user?.name)} asked for time off. Tap to review it.`,
      href: "/supervisor/leave",
    },
    {
      subject: `Time off request from ${name}`,
      heading: "Time off request",
      line: `${name} asked for time off. It is waiting for your approval.`,
      details: requestDetails(request, true),
      button: "Review request",
      href: "/supervisor/leave",
    },
  );
}

/** A request just went to PENDING_HR: everyone in the company who gives the HR approval, but not the person who asked or who passed it on. */
export async function alertLeaveWaitingOnHr(leaveRequestId: string, actorEmployeeId: string | null): Promise<void> {
  const request = await requestWithOwner(leaveRequestId).catch(() => null);
  if (request?.status !== "PENDING_HR" || !request.employee.tenantId) return;

  const approvers = await hrApprovers(request.employee.tenantId, [request.employee.id, actorEmployeeId]);

  const name = fullName(request.employee.user?.name);
  await tell(
    approvers.map((a) => a.userId),
    {
      title: "Time off waiting on HR",
      body: `${firstName(request.employee.user?.name)}'s time off request is ready for HR approval.`,
      href: "/supervisor/leave?tab=hr-pending",
    },
    {
      subject: `${name}'s time off is ready for HR approval`,
      heading: "Time off ready for HR approval",
      line: `The supervisor approved this request from ${name}. It needs HR approval to be final.`,
      details: requestDetails(request, true),
      button: "Review request",
      href: "/supervisor/leave?tab=hr-pending",
    },
  );
}

/** A request was just approved by HR or refused: the person who asked. */
export async function alertLeaveDecided(leaveRequestId: string): Promise<void> {
  const request = await requestWithOwner(leaveRequestId).catch(() => null);
  if (!request?.employee.userId) return;
  const note = request.reviewNote?.trim();
  if (request.status === "APPROVED") {
    await tell(
      [request.employee.userId],
      { title: "Time off approved", body: "Your time off request was approved.", href: "/leave" },
      {
        subject: "Your time off was approved",
        heading: "Time off approved",
        line: "Your time off request was approved.",
        details: requestDetails(request, false),
        button: "View my time off",
        href: "/leave",
      },
    );
  } else if (request.status === "REJECTED") {
    await tell(
      [request.employee.userId],
      {
        title: "Time off not approved",
        body: "Your time off request was not approved. Open CloudTime to see why.",
        href: "/leave",
      },
      {
        subject: "Your time off request was not approved",
        heading: "Time off not approved",
        line: note ? "Your time off request was not approved. The reviewer left a note." : "Your time off request was not approved. Talk to your supervisor about it.",
        details: [...requestDetails(request, false), ...(note ? ([["Note", note]] as [string, string][]) : [])],
        button: "View my time off",
        href: "/leave",
      },
    );
  }
}
