/**
 * Visitor passes: how long a visitor's badge opens the gate, and where
 * (prisma/schema/visitor.prisma).
 *
 * <p><b>Two kinds.</b> A frequent visitor (a driver, an auditor, a client's
 * account team) gets 6 months, 1 year or 2 years and is renewed when it runs
 * out. A day pass is for somebody here once: a day, a week or a month. Both
 * are a client badge (CL00001...) underneath, so the gate, On Site and the
 * photos treat them like anybody else.
 *
 * <p><b>Days, not times.</b> A pass runs from its first day to its last,
 * whole days in the building's calendar, the way schedule_days keys a day. A
 * one day pass bought at 4:00 PM still works until midnight there, and "a
 * week" is seven days counting today.
 *
 * <p><b>One building.</b> The badge opens only the gate of the building it was
 * created at (Juan, 2026-11-06). A tablet tells CloudTime which building it is
 * by its warehouse number; one that sends none is not refused for it, because
 * locking a visitor out over a tablet setting helps nobody (measured the same
 * day: every refusal in the last 14 days came with a number but 2, from an
 * unnamed tablet on Oct 30).
 */

export type VisitorKind = "FREQUENT" | "DAY_PASS";
export type VisitorTerm = "SIX_MONTHS" | "ONE_YEAR" | "TWO_YEARS" | "DAY" | "WEEK" | "MONTH";

/** Each kind's lengths, shortest first, as they are offered. */
export const VISITOR_TERMS: Record<VisitorKind, readonly VisitorTerm[]> = {
  FREQUENT: ["SIX_MONTHS", "ONE_YEAR", "TWO_YEARS"],
  DAY_PASS: ["DAY", "WEEK", "MONTH"],
};

/** The length each kind starts on. */
export const DEFAULT_VISITOR_TERM: Record<VisitorKind, VisitorTerm> = { FREQUENT: "ONE_YEAR", DAY_PASS: "DAY" };

export const VISITOR_TERM_LABEL: Record<VisitorTerm, string> = {
  SIX_MONTHS: "6 months",
  ONE_YEAR: "1 year",
  TWO_YEARS: "2 years",
  DAY: "1 day",
  WEEK: "1 week",
  MONTH: "1 month",
};

export const VISITOR_KIND_LABEL: Record<VisitorKind, string> = {
  FREQUENT: "Frequent visitor",
  DAY_PASS: "Day pass",
};

export function isVisitorKind(v: unknown): v is VisitorKind {
  return v === "FREQUENT" || v === "DAY_PASS";
}

/** Whether a length belongs to a kind: a day pass can never be given 2 years. */
export function termFitsKind(kind: VisitorKind, term: unknown): term is VisitorTerm {
  return (VISITOR_TERMS[kind] as readonly unknown[]).includes(term);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parts(day: string): [number, number, number] {
  if (!DAY.test(day)) throw new Error(`Not a calendar day: ${day}`);
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

const fmt = (date: Date) => date.toISOString().slice(0, 10);

/** A calendar day plus some days. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = parts(day);
  return fmt(new Date(Date.UTC(y, m - 1, d + days)));
}

/**
 * A calendar day plus some months, kept inside the target month: Jan 31 plus
 * one month is Feb 28 (29 in a leap year), never Mar 3.
 */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = parts(day);
  const lastOfTarget = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastOfTarget))));
}

/**
 * The last day a pass of this length starting on `from` opens the gate.
 * Inclusive: a day pass ends the day it starts, a week ends six days later,
 * and a month or more ends the day before the same date comes round.
 */
export function lastDayOf(term: VisitorTerm, from: string): string {
  switch (term) {
    case "DAY":
      return from;
    case "WEEK":
      return addDays(from, 6);
    case "MONTH":
      return addDays(addMonths(from, 1), -1);
    case "SIX_MONTHS":
      return addDays(addMonths(from, 6), -1);
    case "ONE_YEAR":
      return addDays(addMonths(from, 12), -1);
    case "TWO_YEARS":
      return addDays(addMonths(from, 24), -1);
  }
}

/**
 * Where a renewal starts: today when the pass has run out, otherwise the day
 * after it would have ended, so renewing early never throws away days already
 * given.
 */
export function renewalStart(validUntil: string, today: string): string {
  return validUntil < today ? today : addDays(validUntil, 1);
}

export type PassStanding = "VALID" | "NOT_YET" | "EXPIRED" | "ENDED" | "OTHER_BUILDING";

export interface PassFacts {
  siteId: string;
  validFrom: string;
  validUntil: string;
  endedAt: Date | null;
}

/**
 * Whether a pass opens this gate today. `gateSiteId` is the building the
 * tablet named, or null when it named none (not held against the visitor).
 * Ended outranks everything, because somebody chose it; then the building,
 * because a badge at the wrong door is wrong whatever its dates.
 */
export function passStanding(pass: PassFacts, today: string, gateSiteId: string | null): PassStanding {
  if (pass.endedAt) return "ENDED";
  if (gateSiteId && gateSiteId !== pass.siteId) return "OTHER_BUILDING";
  if (today < pass.validFrom) return "NOT_YET";
  if (today > pass.validUntil) return "EXPIRED";
  return "VALID";
}

/** The gate check's reason for a visitor it refuses, by standing. */
export const VISITOR_REFUSAL_REASON: Record<Exclude<PassStanding, "VALID">, string> = {
  NOT_YET: "VISITOR_NOT_YET",
  EXPIRED: "VISITOR_EXPIRED",
  ENDED: "VISITOR_ENDED",
  OTHER_BUILDING: "VISITOR_OTHER_BUILDING",
};
