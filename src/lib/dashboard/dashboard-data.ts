import { db } from "@/lib/db";
import { parseUtcDate } from "@/lib/utils/date";
import type { BadgeTone } from "@/components/ui";

/**
 * Everything the portal design's dashboard puts on screen, in one place.
 *
 * <p>The dashboard is seven cards drawing on six different parts of the
 * schema. Inlining those queries in the page made it impossible to see what
 * the page costs, and every card added another await to a 500-line component.
 *
 * <p>Each section returns null when the viewer has no business seeing it,
 * rather than returning empty data — an empty approval queue and no approval
 * queue mean different things, and the card should be absent for the second.
 */

// ─── Today ────────────────────────────────────────────────────────────────────

export interface TodayPunch {
  id: string;
  time: Date;
  label: string;
  source: string;
}

export interface TodayCard {
  /** Minutes on the clock today, including the open stretch since the last punch. */
  workedMinutes: number;
  state: "OUT" | "WORK" | "MEAL" | "BREAK";
  punches: TodayPunch[];
  /** "On the clock since 07:56 · meal not taken" */
  since: string;
  shift: { start: string; end: string } | null;
}

const PUNCH_LABEL: Record<string, string> = {
  CLOCK_IN: "Clock In",
  CLOCK_OUT: "Clock Out",
  MEAL_START: "Meal Out",
  MEAL_END: "Meal In",
  BREAK_START: "Break Out",
  BREAK_END: "Break In",
};

const SOURCE_LABEL: Record<string, string> = {
  WEB: "Web",
  KIOSK: "Badge",
  MOBILE: "Mobile",
  MANUAL: "Manual",
  SYSTEM: "System",
};

function fmtClock(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

/**
 * Today's punches, and how long the clock has been running.
 *
 * <p>The worked total is computed from the punch pairs rather than read from
 * WorkSegment, because segments are only written once a stretch closes. Mid
 * shift the segment table is one interval behind, and a dashboard that reads
 * "6.20 hours" at 14:00 and still reads it at 15:00 is worse than no number.
 */
export async function getToday(employeeId: string, now: Date): Promise<TodayCard> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const [punches, employee] = await Promise.all([
    db.punch.findMany({
      where: { employeeId, isRejected: false, correctedById: null, punchTime: { gte: start } },
      orderBy: { punchTime: "asc" },
      select: { id: true, punchTime: true, punchType: true, source: true, stateAfter: true, isApproved: true },
    }),
    db.employee.findUnique({
      where: { id: employeeId },
      select: { shift: { select: { startTime: true, endTime: true } } },
    }),
  ]);

  // Walk the day, adding up every stretch spent in WORK.
  let worked = 0;
  let openedAt: Date | null = null;
  let firstIn: Date | null = null;
  let mealTaken = false;

  for (const p of punches) {
    if (p.stateAfter === "WORK") {
      if (!openedAt) openedAt = p.punchTime;
      if (!firstIn) firstIn = p.punchTime;
    } else {
      if (openedAt) {
        worked += Math.max(0, Math.round((p.punchTime.getTime() - openedAt.getTime()) / 60000));
        openedAt = null;
      }
      if (p.stateAfter === "MEAL") mealTaken = true;
    }
  }
  const state = (punches.at(-1)?.stateAfter ?? "OUT") as TodayCard["state"];
  if (openedAt) worked += Math.max(0, Math.round((now.getTime() - openedAt.getTime()) / 60000));

  const last = punches.at(-1);
  const since =
    state === "WORK" && firstIn
      ? `On the clock since ${fmtClock(firstIn)} · ${mealTaken ? "meal taken" : "meal not taken"}`
      : state === "MEAL" && last
        ? `Meal started ${fmtClock(last.punchTime)}`
        : state === "BREAK" && last
          ? `Break started ${fmtClock(last.punchTime)}`
          : last
            ? `Last punch ${fmtClock(last.punchTime)}`
            : "Nothing punched today";

  return {
    workedMinutes: worked,
    state,
    since,
    shift: employee?.shift ? { start: employee.shift.startTime, end: employee.shift.endTime } : null,
    punches: punches.map((p) => ({
      id: p.id,
      time: p.punchTime,
      label: PUNCH_LABEL[p.punchType] ?? p.punchType,
      source: `${SOURCE_LABEL[p.source] ?? p.source}${p.isApproved ? "" : " · pending"}`,
    })),
  };
}

// ─── Needs your approval ──────────────────────────────────────────────────────

export interface ApprovalRow {
  id: string;
  name: string;
  hours: string;
  kind: string;
  tone: BadgeTone | null;
}

/**
 * The approval queue, summarised.
 *
 * <p>Scoped exactly like the Team Timesheets page: a supervisor sees their own
 * team's submitted sheets, payroll sees everything already supervisor-approved.
 * A dashboard that counted differently from the page it links to would be worse
 * than no count.
 */
export async function getApprovalQueue(
  employeeId: string | null,
  tenantId: string,
  isPayroll: boolean,
  limit = 5,
): Promise<{ rows: ApprovalRow[]; total: number; leaveCount: number }> {
  const where = isPayroll
    ? { status: "SUP_APPROVED" as const, employee: { tenantId } }
    : { status: "SUBMITTED" as const, employee: { tenantId, supervisorId: employeeId ?? "" } };

  const [sheets, total, leaveCount] = await Promise.all([
    db.timesheet.findMany({
      where,
      take: limit,
      orderBy: { updatedAt: "asc" },
      select: {
        id: true,
        employee: { select: { user: { select: { name: true } } } },
        overtimeBuckets: { select: { bucket: true, totalMinutes: true } },
        exceptions: { where: { resolvedAt: null }, select: { id: true } },
      },
    }),
    db.timesheet.count({ where }),
    db.leaveRequest.count({
      where: {
        status: "PENDING",
        employee: isPayroll ? { tenantId } : { tenantId, supervisorId: employeeId ?? "" },
      },
    }),
  ]);

  return {
    total,
    leaveCount,
    rows: sheets.map((ts) => {
      const mins = ts.overtimeBuckets.reduce((n, b) => n + b.totalMinutes, 0);
      const open = ts.exceptions.length;
      return {
        id: ts.id,
        name: ts.employee.user?.name ?? "Unknown",
        hours: (mins / 60).toFixed(2),
        kind: open > 0 ? `${open} exception${open === 1 ? "" : "s"}` : "Clean",
        tone: open > 0 ? ("warning" as BadgeTone) : null,
      };
    }),
  };
}

// ─── Exceptions feed ──────────────────────────────────────────────────────────

export interface ExceptionRow {
  id: string;
  name: string;
  date: Date;
  type: string;
}

export async function getExceptionsFeed(
  employeeId: string | null,
  tenantId: string,
  isPayroll: boolean,
  payPeriodId: string | null,
  limit = 5,
): Promise<{ rows: ExceptionRow[]; total: number }> {
  const where = {
    resolvedAt: null,
    exceptionType: { not: "SCAN_DISCREPANCY" as const },
    timesheet: {
      ...(payPeriodId ? { payPeriodId } : {}),
      employee: isPayroll ? { tenantId } : { tenantId, supervisorId: employeeId ?? "" },
    },
  };

  const [rows, total] = await Promise.all([
    db.exception.findMany({
      where,
      take: limit,
      orderBy: { occurredAt: "desc" },
      select: {
        id: true,
        occurredAt: true,
        exceptionType: true,
        timesheet: { select: { employee: { select: { user: { select: { name: true } } } } } },
      },
    }),
    db.exception.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((e) => ({
      id: e.id,
      name: e.timesheet.employee.user?.name ?? "Unknown",
      date: e.occurredAt,
      type: e.exceptionType,
    })),
  };
}

// ─── Team presence ────────────────────────────────────────────────────────────

export interface PresenceDept {
  dept: string;
  inCount: number;
  mealCount: number;
  total: number;
}

export interface Presence {
  onClock: number;
  onMeal: number;
  notIn: number;
  onLeave: number;
  byDept: PresenceDept[];
}

type StateRow = { employeeId: string; state: string; dept: string | null };

/**
 * Who is on the clock right now, by department.
 *
 * <p>One DISTINCT ON rather than a punch-state lookup per employee: the tenant
 * has a few hundred active people, and the per-employee helper would be that
 * many round trips on every dashboard load.
 *
 * <p>Employees who have never punched do not appear in the state query at all,
 * which is why the department totals come from a separate count — without it
 * "not in" would silently exclude everyone who has not badged this year.
 */
export async function getPresence(tenantId: string, supervisorId: string | null): Promise<Presence> {
  const scoped = supervisorId
    ? { tenantId, isActive: true, supervisorId }
    : { tenantId, isActive: true };

  const [states, headcount] = await Promise.all([
    supervisorId
      ? db.$queryRaw<StateRow[]>`
          SELECT DISTINCT ON (p."employeeId")
                 p."employeeId"      AS "employeeId",
                 p."stateAfter"::text AS state,
                 d.name              AS dept
          FROM "punches" p
          JOIN "employees" e   ON e.id = p."employeeId"
          LEFT JOIN "departments" d ON d.id = e."departmentId"
          WHERE e."tenantId" = ${tenantId}
            AND e."isActive" = true
            AND e."supervisorId" = ${supervisorId}
            AND p."isRejected" = false
            AND p."correctedById" IS NULL
          ORDER BY p."employeeId", p."roundedTime" DESC
        `
      : db.$queryRaw<StateRow[]>`
          SELECT DISTINCT ON (p."employeeId")
                 p."employeeId"      AS "employeeId",
                 p."stateAfter"::text AS state,
                 d.name              AS dept
          FROM "punches" p
          JOIN "employees" e   ON e.id = p."employeeId"
          LEFT JOIN "departments" d ON d.id = e."departmentId"
          WHERE e."tenantId" = ${tenantId}
            AND e."isActive" = true
            AND p."isRejected" = false
            AND p."correctedById" IS NULL
          ORDER BY p."employeeId", p."roundedTime" DESC
        `,
    db.employee.findMany({
      where: scoped,
      select: { id: true, onLeave: true, department: { select: { name: true } } },
    }),
  ]);

  const stateById = new Map(states.map((s) => [s.employeeId, s.state]));

  const byDept = new Map<string, PresenceDept>();
  let onClock = 0;
  let onMeal = 0;
  let onLeave = 0;

  for (const emp of headcount) {
    const name = emp.department?.name ?? "Unassigned";
    const row = byDept.get(name) ?? { dept: name, inCount: 0, mealCount: 0, total: 0 };
    row.total += 1;

    if (emp.onLeave) {
      onLeave += 1;
    } else {
      const state = stateById.get(emp.id) ?? "OUT";
      if (state === "WORK") {
        onClock += 1;
        row.inCount += 1;
      } else if (state === "MEAL" || state === "BREAK") {
        onMeal += 1;
        row.mealCount += 1;
      }
    }
    byDept.set(name, row);
  }

  return {
    onClock,
    onMeal,
    onLeave,
    notIn: headcount.length - onClock - onMeal - onLeave,
    byDept: [...byDept.values()].sort((a, b) => b.total - a.total).slice(0, 6),
  };
}

// ─── Coming up ────────────────────────────────────────────────────────────────

export interface UpcomingRow {
  key: string;
  date: Date;
  what: string;
  kind: string;
  tone: BadgeTone;
}

/**
 * The next 30 days: the period close, your own leave, and site holidays.
 *
 * <p>Merged into one list on purpose. These are three tables, but to the
 * person reading it they are one question — what is coming that I should know
 * about — and three separate cards is how a holiday gets missed.
 */
export async function getUpcoming(
  employeeId: string | null,
  tenantId: string,
  now: Date,
  payPeriodEnd: Date | null,
): Promise<UpcomingRow[]> {
  // From the start of today, not from this moment. startDate and the holiday
  // date are @db.Date at UTC midnight, so comparing them against a mid-afternoon
  // timestamp drops anything happening today — which is exactly the row someone
  // opening the dashboard at 2pm most needs to see.
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const horizon = new Date(from);
  horizon.setUTCDate(horizon.getUTCDate() + 30);

  const [leave, holidays] = await Promise.all([
    employeeId
      ? db.leaveRequest.findMany({
          where: {
            employeeId,
            status: { in: ["APPROVED", "PENDING"] },
            startDate: { gte: from, lte: horizon },
          },
          orderBy: { startDate: "asc" },
          take: 5,
          select: {
            id: true,
            startDate: true,
            endDate: true,
            status: true,
            durationMinutes: true,
            leaveType: { select: { name: true } },
          },
        })
      : [],
    db.holiday.findMany({
      where: { tenantId, isActive: true, date: { gte: from, lte: horizon } },
      orderBy: { date: "asc" },
      take: 3,
      select: { id: true, name: true, date: true, observedDate: true },
    }),
  ]);

  const rows: UpcomingRow[] = [];

  if (payPeriodEnd && payPeriodEnd >= from && payPeriodEnd <= horizon) {
    rows.push({
      key: "close",
      date: payPeriodEnd,
      what: "Pay period close — approvals due",
      kind: "Payroll",
      tone: "info",
    });
  }

  for (const l of leave) {
    const days = Math.round(l.durationMinutes / 60);
    const span =
      parseUtcDate(l.startDate).getTime() === parseUtcDate(l.endDate).getTime()
        ? `${l.leaveType.name} (${days}h)`
        : `${l.leaveType.name} — ${days}h`;
    rows.push({
      key: l.id,
      date: parseUtcDate(l.startDate),
      what: span,
      kind: l.status === "APPROVED" ? "Approved" : "Pending",
      tone: l.status === "APPROVED" ? "success" : "warning",
    });
  }

  for (const h of holidays) {
    rows.push({
      key: h.id,
      date: parseUtcDate(h.observedDate ?? h.date),
      what: h.name,
      kind: "Holiday",
      tone: "purple",
    });
  }

  return rows.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 6);
}
