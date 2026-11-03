import { db } from "@/lib/db";

/**
 * Working time checks for a rule set that follows one country's working time
 * law: the longest working day, the shortest rest between two working days,
 * and the breaks a day of work needs. What falls short becomes an exception
 * on the timecard, the way a missed punch does.
 *
 * <p>For EU companies. A rule set set to OFF, which every rule set is unless
 * someone picks a country, is never read here: rebuildSegments does not call
 * this at all, so nothing changes for it.
 *
 * <p>The limits, and where they come from:
 * <ul>
 *   <li><b>Germany</b> (Arbeitszeitgesetz): 10 hours of work a day at most
 *       (§3), 30 minutes of breaks after 6 hours and 45 after 9, counted in
 *       blocks of at least 15 minutes (§4), 11 hours of rest between working
 *       days (§5).</li>
 *   <li><b>Netherlands</b> (Arbeidstijdenwet): 12 hours a shift at most
 *       (5:7), 30 minutes of breaks after 5.5 hours and 45 after 10, in blocks
 *       of at least 15 minutes (5:4), 11 hours of rest (5:3).</li>
 *   <li><b>United Kingdom</b> (Working Time Regulations 1998): one
 *       uninterrupted break of 20 minutes after 6 hours (reg 12), 11 hours of
 *       rest (reg 10). There is no daily maximum.</li>
 * </ul>
 * Weekly limits (Germany's 48 hour average, the UK's opt out) are not checked.
 */

export type WorkingTimeCountry = "DE" | "NL" | "UK";

export interface WorkingTimeRules {
  country: WorkingTimeCountry;
  /** The longest working day, in minutes. Null where the law sets none. */
  maxDailyMinutes: number | null;
  /** The shortest rest between two working days, in minutes. */
  minRestMinutes: number;
  /** Breaks a day needs once its work passes `afterMinutes`, longest first. */
  breaks: { afterMinutes: number; needMinutes: number }[];
  /** The shortest gap that counts as a break. */
  minBreakBlockMinutes: number;
  /** The UK counts one uninterrupted break, not the sum of several. */
  singleBreak: boolean;
}

export const WORKING_TIME_RULES: Record<WorkingTimeCountry, WorkingTimeRules> = {
  DE: {
    country: "DE",
    maxDailyMinutes: 600,
    minRestMinutes: 660,
    breaks: [
      { afterMinutes: 540, needMinutes: 45 },
      { afterMinutes: 360, needMinutes: 30 },
    ],
    minBreakBlockMinutes: 15,
    singleBreak: false,
  },
  NL: {
    country: "NL",
    maxDailyMinutes: 720,
    minRestMinutes: 660,
    breaks: [
      { afterMinutes: 600, needMinutes: 45 },
      { afterMinutes: 330, needMinutes: 30 },
    ],
    minBreakBlockMinutes: 15,
    singleBreak: false,
  },
  UK: {
    country: "UK",
    maxDailyMinutes: null,
    minRestMinutes: 660,
    breaks: [{ afterMinutes: 360, needMinutes: 20 }],
    minBreakBlockMinutes: 20,
    singleBreak: true,
  },
};

/** The rules for a rule set's setting, or null when it checks nothing. */
export function rulesFor(setting: string | null | undefined): WorkingTimeRules | null {
  return setting && setting in WORKING_TIME_RULES ? WORKING_TIME_RULES[setting as WorkingTimeCountry] : null;
}

export interface WorkStretch {
  /** The working day it belongs to, YYYY-MM-DD. */
  day: string;
  start: Date;
  end: Date;
  minutes: number;
}

export type WorkingTimeIssue =
  | { type: "LONG_SHIFT"; day: string; workedMinutes: number; limitMinutes: number }
  | { type: "SHORT_BREAK"; day: string; workedMinutes: number; breakMinutes: number; needMinutes: number }
  | { type: "SHORT_REST"; day: string; restMinutes: number; needMinutes: number };

/** A gap this short between two days is one shift crossing midnight. */
export const SAME_SHIFT_MINUTES = 180;

const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

/**
 * What a run of work falls short on. `stretches` are the work periods of the
 * timecard; `previousEnd` is when the person last stopped work before them,
 * so the first day's rest can be checked too. Pure: no database.
 */
export function findWorkingTimeIssues(stretches: WorkStretch[], rules: WorkingTimeRules, previousEnd: Date | null): WorkingTimeIssue[] {
  const issues: WorkingTimeIssue[] = [];
  const sorted = [...stretches].sort((a, b) => a.start.getTime() - b.start.getTime());
  const days = new Map<string, WorkStretch[]>();
  for (const s of sorted) days.set(s.day, [...(days.get(s.day) ?? []), s]);

  for (const [day, list] of days) {
    const worked = list.reduce((n, s) => n + s.minutes, 0);

    if (rules.maxDailyMinutes !== null && worked > rules.maxDailyMinutes) {
      issues.push({ type: "LONG_SHIFT", day, workedMinutes: worked, limitMinutes: rules.maxDailyMinutes });
    }

    const need = rules.breaks.find((b) => worked > b.afterMinutes)?.needMinutes ?? 0;
    if (need > 0) {
      const gaps: number[] = [];
      for (let i = 1; i < list.length; i++) {
        const gap = minutesBetween(list[i - 1].end, list[i].start);
        if (gap >= rules.minBreakBlockMinutes) gaps.push(gap);
      }
      const taken = rules.singleBreak ? Math.max(0, ...gaps) : gaps.reduce((n, g) => n + g, 0);
      if (taken < need) issues.push({ type: "SHORT_BREAK", day, workedMinutes: worked, breakMinutes: taken, needMinutes: need });
    }
  }

  // Rest: the gap from the end of one working day to the start of the next.
  // A shift that runs past midnight is cut into two days with no gap, so a
  // gap shorter than SAME_SHIFT_MINUTES across a day change is the same shift
  // going on, not a rest that was too short.
  let lastEnd = previousEnd;
  let lastDay: string | null = null;
  for (const s of sorted) {
    if (s.day !== lastDay && lastEnd) {
      const rest = minutesBetween(lastEnd, s.start);
      if (rest >= SAME_SHIFT_MINUTES && rest < rules.minRestMinutes) {
        issues.push({ type: "SHORT_REST", day: s.day, restMinutes: rest, needMinutes: rules.minRestMinutes });
      }
    }
    if (!lastEnd || s.end > lastEnd) lastEnd = s.end;
    lastDay = s.day;
  }

  return issues;
}

/** "10 h 45 min", "30 min", "11 h". */
export function hoursAndMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The sentence an exception carries, in plain words. */
export function describeIssue(issue: WorkingTimeIssue, dayWords: string): string {
  switch (issue.type) {
    case "LONG_SHIFT":
      return `Worked ${hoursAndMinutes(issue.workedMinutes)} on ${dayWords}. The most allowed is ${hoursAndMinutes(issue.limitMinutes)}.`;
    case "SHORT_BREAK":
      return `Breaks of ${hoursAndMinutes(issue.breakMinutes)} on ${dayWords} for ${hoursAndMinutes(issue.workedMinutes)} of work. At least ${hoursAndMinutes(issue.needMinutes)} is required.`;
    case "SHORT_REST":
      return `Only ${hoursAndMinutes(issue.restMinutes)} of rest before work on ${dayWords}. At least ${hoursAndMinutes(issue.needMinutes)} is required.`;
  }
}

const TYPES = ["LONG_SHIFT", "SHORT_BREAK", "SHORT_REST"] as const;

/**
 * Brings a timecard's working time exceptions in line with its work: raises
 * one for each day and kind that falls short and has none yet, and resolves
 * the open ones a recalculation no longer finds. One a person resolved stays
 * resolved and is not raised again for the same day.
 */
export async function syncWorkingTimeExceptions(
  timesheetId: string,
  employeeId: string,
  rules: WorkingTimeRules,
  timezone: string,
): Promise<void> {
  const segments = await db.workSegment.findMany({
    where: { timesheetId, segmentType: "WORK" },
    select: { segmentDate: true, startTime: true, endTime: true, durationSeconds: true },
    orderBy: { startTime: "asc" },
  });
  const stretches: WorkStretch[] = segments.map((s) => ({
    day: s.segmentDate.toISOString().slice(0, 10),
    start: s.startTime,
    end: s.endTime,
    minutes: Math.round(s.durationSeconds / 60),
  }));

  // When the person last stopped work before this timecard, for the first day's rest.
  const firstStart = stretches[0]?.start;
  const previous = firstStart
    ? await db.workSegment.findFirst({
        where: { segmentType: "WORK", endTime: { lte: firstStart }, timesheet: { employeeId, id: { not: timesheetId } } },
        select: { endTime: true },
        orderBy: { endTime: "desc" },
      })
    : null;

  const issues = findWorkingTimeIssues(stretches, rules, previous?.endTime ?? null);

  const existing = await db.exception.findMany({
    where: { timesheetId, exceptionType: { in: [...TYPES] } },
    select: { id: true, exceptionType: true, occurredAt: true, resolvedAt: true },
  });
  const keyOf = (type: string, day: string) => `${type}|${day}`;
  const found = new Set(issues.map((i) => keyOf(i.type, i.day)));
  const have = new Map(existing.map((e) => [keyOf(e.exceptionType, e.occurredAt.toISOString().slice(0, 10)), e]));

  for (const issue of issues) {
    if (have.has(keyOf(issue.type, issue.day))) continue;
    // Noon UTC, so the day reads the same in every time zone, as missed punches do.
    const occurredAt = new Date(`${issue.day}T12:00:00.000Z`);
    const dayWords = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: timezone }).format(occurredAt);
    await db.exception.create({
      data: { timesheetId, exceptionType: issue.type, description: describeIssue(issue, dayWords), occurredAt },
    });
  }

  const cleared = existing.filter((e) => !e.resolvedAt && !found.has(keyOf(e.exceptionType, e.occurredAt.toISOString().slice(0, 10))));
  if (cleared.length) {
    await db.exception.updateMany({
      where: { id: { in: cleared.map((e) => e.id) }, timesheetId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolution: "Cleared when the timecard was recalculated." },
    });
  }
}
