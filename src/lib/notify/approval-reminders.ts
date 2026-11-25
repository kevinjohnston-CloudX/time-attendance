import { db } from "@/lib/db";
import { directReportsOf } from "@/lib/get-subordinate-ids";
import { pushToUsers } from "@/lib/push/send";
import type { PushMessage } from "@/lib/push/types";
import { hasPermissionByLegacy } from "@/lib/rbac/permission-resolver";
import { countMissedPunchRequests } from "@/lib/team/team-overview";
import { emailUsers, leaveDays, leaveHours, type ApprovalEmail } from "./approval-email";
import { coversSite, hrApprovers, type HrApprover } from "./approvers";
import { dateFormat } from "@/lib/utils/date-format";

/**
 * The two reminders about approvals left waiting, chosen over a daily nag
 * (Juan, 2026-11-16): leaving a request unanswered on purpose has to stay
 * possible, so a reminder only goes out when silence would hurt someone, and
 * the routine one comes once a week.
 *
 * <p><b>Time off about to start.</b> A request still waiting two days before
 * its first day reminds whoever holds it: the supervisor while it is Pending,
 * the HR approvers once it is Pending HR. The job runs once a day and picks
 * requests starting exactly two days out, so each one is reminded once with
 * nothing stored to remember it.
 *
 * <p><b>Monday summary.</b> One email per person with anything waiting on
 * them, counted the way the Approvals screen counts it; nobody with nothing
 * waiting hears anything.
 *
 * <p>Both take `send: false` to return what they would send without sending,
 * which is how they are checked against real data.
 */

const LEAD_DAYS = 2;

/** Today's date in Eastern time, every company's zone today, as the UTC midnight @db.Date columns hold. */
function easternToday(now: Date): Date {
  const ymd = dateFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

function fullName(name: string | null | undefined): string {
  return name?.trim() || "An employee";
}
function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Someone";
}

type Planned = { userIds: string[]; push?: PushMessage; email: ApprovalEmail };

async function deliver(plan: Planned[], send: boolean): Promise<void> {
  if (!send) return;
  for (const p of plan) {
    await Promise.all([p.push ? pushToUsers(p.userIds, p.push) : Promise.resolve(), emailUsers(p.userIds, p.email)]);
  }
}

// ─── Time off about to start ─────────────────────────────────────────────────

export async function remindTimeOffStartingSoon(now: Date, { send }: { send: boolean }): Promise<Planned[]> {
  const start = new Date(easternToday(now).getTime() + LEAD_DAYS * 86_400_000);
  const requests = await db.leaveRequest.findMany({
    where: { status: { in: ["PENDING", "PENDING_HR"] }, startDate: start, employee: { isActive: true } },
    select: {
      status: true,
      startDate: true,
      endDate: true,
      durationSeconds: true,
      leaveType: { select: { name: true } },
      employee: {
        select: {
          id: true,
          tenantId: true,
          siteId: true,
          user: { select: { name: true } },
          supervisor: { select: { userId: true, isActive: true } },
        },
      },
    },
  });

  const hrByCompany = new Map<string, HrApprover[]>();
  const plan: Planned[] = [];
  for (const r of requests) {
    const name = fullName(r.employee.user?.name);
    const hours = leaveHours(r.durationSeconds);
    const details: [string, string][] = [
      ["Employee", name],
      ["Type", r.leaveType.name],
      ["Dates", leaveDays(r.startDate, r.endDate)],
      ...(hours ? ([["Hours", hours]] as [string, string][]) : []),
    ];

    let userIds: string[] = [];
    let waitingFor: string;
    let href: string;
    if (r.status === "PENDING") {
      const sup = r.employee.supervisor;
      if (sup?.isActive && sup.userId) userIds = [sup.userId];
      waitingFor = "your approval";
      href = "/approvals?view=leave";
    } else {
      const tenantId = r.employee.tenantId;
      if (!hrByCompany.has(tenantId)) hrByCompany.set(tenantId, await hrApprovers(tenantId));
      userIds = hrByCompany.get(tenantId)!
        .filter((a) => a.employeeId !== r.employee.id && coversSite(a, r.employee.siteId))
        .map((a) => a.userId);
      waitingFor = "HR approval";
      href = "/approvals?view=leave&tab=hr-pending";
    }
    if (userIds.length === 0) continue;

    plan.push({
      userIds,
      push: {
        title: "Time off starts soon",
        body: `${firstName(r.employee.user?.name)}'s time off starts in ${LEAD_DAYS} days and still needs ${waitingFor}.`,
        href,
      },
      email: {
        subject: `${name}'s time off starts in ${LEAD_DAYS} days`,
        heading: "Time off starts soon",
        line: `${name}'s time off starts in ${LEAD_DAYS} days and is still waiting for ${waitingFor}.`,
        details,
        button: "Review request",
        href,
      },
    });
  }
  await deliver(plan, send);
  return plan;
}

// ─── Monday summary ──────────────────────────────────────────────────────────

type Waiting = { userId: string; timeOff: number; missedPunches: number; timeOffHr: number };

export async function weeklyApprovalSummary({ send }: { send: boolean }): Promise<Planned[]> {
  const waiting = new Map<string, Waiting>();
  const add = (userId: string, part: Partial<Omit<Waiting, "userId">>) => {
    const w = waiting.get(userId) ?? { userId, timeOff: 0, missedPunches: 0, timeOffHr: 0 };
    w.timeOff += part.timeOff ?? 0;
    w.missedPunches += part.missedPunches ?? 0;
    w.timeOffHr += part.timeOffHr ?? 0;
    waiting.set(userId, w);
  };

  // Supervisors: anyone over a person with time off or a missed punch waiting,
  // as their main or an additional supervisor, as the Approvals screen counts.
  const supervisorsOf = { select: { supervisorId: true, additionalSupervisors: { select: { supervisorId: true } } } } as const;
  const [pendingLeave, pendingPunches] = await Promise.all([
    db.leaveRequest.findMany({ where: { status: "PENDING", employee: { isActive: true } }, select: { employee: supervisorsOf } }),
    db.punch.findMany({
      where: { source: "MANUAL", isApproved: false, isRejected: false, correctedById: null, correctsId: null, approvedById: null, employee: { isActive: true } },
      take: 2000,
      select: { employee: supervisorsOf },
    }),
  ]);
  const supervisorIds = new Set<string>();
  for (const row of [...pendingLeave, ...pendingPunches]) {
    if (row.employee.supervisorId) supervisorIds.add(row.employee.supervisorId);
    for (const a of row.employee.additionalSupervisors) supervisorIds.add(a.supervisorId);
  }
  const supervisors = await db.employee.findMany({
    where: { id: { in: [...supervisorIds] }, isActive: true },
    select: { id: true, userId: true, tenantId: true, customRoleId: true },
  });
  const can = new Map<string, boolean>();
  const roleCan = async (role: string | null, perm: string) => {
    const key = `${role}:${perm}`;
    if (!can.has(key)) can.set(key, await hasPermissionByLegacy(role, perm));
    return can.get(key)!;
  };
  for (const s of supervisors) {
    const [leaveOk, punchOk] = await Promise.all([
      roleCan(s.customRoleId, "LEAVE_APPROVE_TEAM"),
      (async () => (await roleCan(s.customRoleId, "PUNCH_EDIT_TEAM")) || roleCan(s.customRoleId, "PUNCH_FIX_MISSED_TEAM"))(),
    ]);
    const [timeOff, missedPunches] = await Promise.all([
      leaveOk ? db.leaveRequest.count({ where: { status: "PENDING", employee: { tenantId: s.tenantId, isActive: true, ...directReportsOf(s.id) } } }) : 0,
      punchOk ? countMissedPunchRequests(s.tenantId, s.id, false) : 0,
    ]);
    if (timeOff || missedPunches) add(s.userId, { timeOff, missedPunches });
  }

  // HR: every request waiting on HR in their company, except their own.
  const hrWaiting = await db.leaveRequest.findMany({
    where: { status: "PENDING_HR", employee: { isActive: true } },
    select: { employee: { select: { id: true, tenantId: true, siteId: true } } },
  });
  const byCompany = new Map<string, { id: string; siteId: string }[]>();
  for (const r of hrWaiting) byCompany.set(r.employee.tenantId, [...(byCompany.get(r.employee.tenantId) ?? []), r.employee]);
  for (const [tenantId, owners] of byCompany) {
    for (const a of await hrApprovers(tenantId)) {
      // At their own sites only, as Approvals lists them.
      const timeOffHr = owners.filter((o) => o.id !== a.employeeId && coversSite(a, o.siteId)).length;
      if (timeOffHr) add(a.userId, { timeOffHr });
    }
  }

  const plan: Planned[] = [...waiting.values()].map((w) => {
    const total = w.timeOff + w.missedPunches + w.timeOffHr;
    const rows: [string, string][] = [];
    if (w.timeOff) rows.push(["Time off requests", String(w.timeOff)]);
    if (w.missedPunches) rows.push(["Missed punch requests", String(w.missedPunches)]);
    if (w.timeOffHr) rows.push(["Time off waiting on HR", String(w.timeOffHr)]);
    return {
      userIds: [w.userId],
      email: {
        subject: total === 1 ? "1 approval is waiting for you in CloudTime" : `${total} approvals are waiting for you in CloudTime`,
        heading: "Approvals waiting",
        line: total === 1 ? "This request is still waiting for your decision." : "These requests are still waiting for your decision.",
        details: rows,
        button: "Open approvals",
        href: "/approvals",
      },
    };
  });
  await deliver(plan, send);
  return plan;
}
