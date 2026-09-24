import { Prisma } from "@prisma/client";

/**
 * What a time clock scan means now, not what the timecard made of it at the
 * moment of the tap.
 *
 * <p>A scan keeps the punch type the timecard gave it when it was recorded
 * (`timecardPunchType`), and that copy is never rewritten: the scan log is
 * the untouched record of what each reader said. When payroll or a
 * supervisor corrects the punch, the correction is a new punch that the old
 * one points to (`correctedById`), and the timecard follows it. Live
 * Attendance follows it too, so a going home tap saved as "meal start" and
 * corrected to a clock out reads as a clock out everywhere, while the log
 * still says what the tap was first recorded as.
 *
 * <p>Only approved, unrefused corrections count, the same rule the timecard
 * uses for the current state. A chain is followed up to three corrections
 * deep; none in the data goes past two.
 */

type Link = {
  punchType: string;
  stateAfter: string;
  isApproved: boolean;
  isRejected: boolean;
  correctedBy?: Link | null;
};

const LINK = { punchType: true, stateAfter: true, isApproved: true, isRejected: true } as const;

/** The punch behind a scan and its corrections, for a Prisma select. */
export const PUNCH_CHAIN = {
  select: {
    ...LINK,
    correctedBy: { select: { ...LINK, correctedBy: { select: { ...LINK, correctedBy: { select: LINK } } } } },
  },
} as const;

/** The punch a scan stands for now: the last approved correction, or the punch itself. */
export function currentPunch(p: Link | null | undefined): { punchType: string; stateAfter: string } | null {
  if (!p) return null;
  let cur: Link = p;
  for (let i = 0; i < 3 && cur.correctedBy && cur.correctedBy.isApproved && !cur.correctedBy.isRejected; i++) {
    cur = cur.correctedBy;
  }
  return { punchType: cur.punchType, stateAfter: cur.stateAfter };
}

/**
 * The same for raw SQL over a scan aliased `s`: the joins to add after FROM,
 * and the columns they give, `effectiveType` and `effectiveState`.
 */
export const PUNCH_CHAIN_JOINS = Prisma.sql`
  LEFT JOIN "punches" pp ON pp.id = s."punchId"
  LEFT JOIN "punches" c1 ON c1.id = pp."correctedById" AND c1."isApproved" AND NOT c1."isRejected"
  LEFT JOIN "punches" c2 ON c2.id = c1."correctedById" AND c2."isApproved" AND NOT c2."isRejected"
  LEFT JOIN "punches" c3 ON c3.id = c2."correctedById" AND c3."isApproved" AND NOT c3."isRejected"
`;

export const EFFECTIVE_TYPE_SQL = Prisma.sql`COALESCE(c3."punchType", c2."punchType", c1."punchType")::text`;
export const EFFECTIVE_STATE_SQL = Prisma.sql`COALESCE(c3."stateAfter", c2."stateAfter", c1."stateAfter")::text`;
