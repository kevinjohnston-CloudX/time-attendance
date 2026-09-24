/**
 * The shapes the On Site board draws, shared by the server that computes them
 * and the client that polls for them. Nothing in here imports the database, so
 * the client bundle can use it.
 */

/**
 * Where somebody stands right now, as one answer.
 *
 * <p>Two independent streams feed it: the security gate (in the building or
 * not) and the time clock (on the clock or not). They are kept apart in
 * `scan_events` because both can be true in any combination, and the
 * combinations are what the people reading this page care about:
 *
 * <ul>
 *   <li>WORKING: on the clock, and through the gate where the site has one.</li>
 *   <li>ON_MEAL: clocked out for a meal or a break.</li>
 *   <li>OFF_CLOCK: through the gate, not on the clock. Inside the building and
 *       not being paid, which is what loss prevention asks about first.</li>
 *   <li>ON_SITE: through the gate and salaried. Salaried people do not use
 *       the time clock, so being inside is simply being at work.</li>
 *   <li>NO_GATE_SCAN: on the clock, but the gate never saw them come in.</li>
 *   <li>LEFT: seen today, now out.</li>
 *   <li>ON_LEAVE: approved time off today, not seen.</li>
 *   <li>NOT_ARRIVED: scheduled today, not seen.</li>
 *   <li>NOT_SCHEDULED: on this site's roster, not scheduled today, not seen.</li>
 * </ul>
 */
export type PresenceStatus =
  | "WORKING"
  | "ON_MEAL"
  | "OFF_CLOCK"
  | "ON_SITE"
  | "NO_GATE_SCAN"
  | "LEFT"
  | "ON_LEAVE"
  | "NOT_ARRIVED"
  | "NOT_SCHEDULED";

export interface PresencePerson {
  id: string;
  name: string;
  employeeCode: string;
  departmentId: string | null;
  department: string | null;
  /** Their job title, or null. What the board shows under a name, so the
   *  card and the panel describe someone the same way. */
  jobTitle: string | null;
  shiftId: string | null;
  shift: string | null;
  /**
   * A signed link to the tablet photo (see photos.ts), or null. The board
   * draws initials in the same frame, which show when there is no photo.
   */
  photoUrl: string | null;
  /** Paid a salary, so not expected to use the time clock. */
  salaried: boolean;
  status: PresenceStatus;
  /** Counted in the building total. */
  inside: boolean;
  /** Which kind of time off the clock, for ON_MEAL. */
  breakKind: "MEAL" | "BREAK" | null;
  /** On a meal and the gate saw them leave: out of the building on a break. */
  outsideOnMeal: boolean;
  /** The moment this status began, ISO. Null when nothing has happened yet. */
  since: string | null;
  /** First arrival today at either reader, ISO. */
  firstInToday: string | null;
  /** Today's schedule in site time, HH:mm, when there is one. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** Minutes past the scheduled start, for somebody who has not arrived. */
  lateMinutes: number | null;
  /** The record is inactive or terminated, and the person is still scanning. */
  inactive: boolean;
  /** The site on their record, when it is not this building: they scanned here from elsewhere. */
  homeSite: string | null;
  /** The security gate's latest word on them, in the last 36 hours. */
  gate: { inside: boolean; at: string; automatic: boolean } | null;
  /** The time clock's latest word on them, in the last 36 hours. */
  clock: { state: "WORK" | "MEAL" | "BREAK" | "OUT"; at: string; automatic: boolean } | null;
}

export interface PresenceBoard {
  site: {
    id: string;
    name: string;
    timezone: string;
    /**
     * The site's gate readers reported inside the lookback window. When they
     * have not, "inside" can only come from the time clock, and the board says
     * so instead of showing a building full of missed gate scans.
     */
    hasGateData: boolean;
    lastGateScanAt: string | null;
  };
  generatedAt: string;
  people: PresencePerson[];
}

export interface PresenceScan {
  id: string;
  at: string;
  stream: "SECURITY" | "TIME_CLOCK";
  direction: "IN" | "OUT" | "UNKNOWN";
  /** What the time clock made of it: CLOCK_IN, MEAL_START and so on. */
  punchType: string | null;
  device: string | null;
  /** Written by the system rather than seen at a reader. */
  automatic: boolean;
  /** The same badge read twice within seconds at the same kind of reader. */
  reread: boolean;
  /** A time clock scan the timecard refused, errored on, or never finished. */
  rejected: boolean;
}

export interface PresenceDetail {
  id: string;
  name: string;
  employeeCode: string;
  jobTitle: string | null;
  department: string | null;
  shift: string | null;
  supervisor: string | null;
  /** Paid a salary, so not expected to use the time clock. */
  salaried: boolean;
  inactive: boolean;
  /** The site on their record, when it is not this building. */
  homeSite: string | null;
  /** A signed link to the tablet photo, or null. */
  photoUrl: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  timezone: string;
  /** The site calendar day shown, and today's, YYYY-MM-DD. */
  day: string;
  today: string;
  /** The day's bounds as instants, ISO. */
  dayStart: string;
  dayEnd: string;
  /** Every scan that day, newest first. */
  scans: PresenceScan[];
  /** The last scan of each kind before the day, which sets where it starts. */
  carryGate: PresenceScan | null;
  carryClock: PresenceScan | null;
}

/* ── Scan log ──────────────────────────────────────────────────────────── */

export type ScanStream = "SECURITY" | "TIME_CLOCK";

/**
 * What the scan log is narrowed to. Department, shift and the search narrow
 * the counts as well as the rows; source, direction and "not accepted" are the
 * counters themselves, so they only narrow the rows.
 */
export interface ScanLogQuery {
  /* `rejected` picks the scans that never counted instead of the ones that did. */
  /** A site calendar day in the last week, YYYY-MM-DD. Null is today. */
  day: string | null;
  stream: ScanStream | null;
  direction: "IN" | "OUT" | null;
  rejected: boolean;
  /**
   * Only each person's first scan of a kind that day: their first entry
   * through the gate, or their first clock in. One row per person.
   */
  first?: "gate" | "clock" | null;
  /** Only the gate scans with no partner: an entry after an entry, an exit after an exit. */
  missed?: boolean;
  departmentId: string | null;
  shiftId: string | null;
  q: string | null;
}

/** One reader event in the log, with the person it belongs to. */
/**
 * What a scan means next to the one before it, for the same person at the
 * same reader that day: how long they had been inside when they left, how
 * long they were out before coming back, how long a meal ran.
 */
export interface ScanContext {
  kind:
    | "inside"
    | "out"
    | "firstIn"
    | "worked"
    | "working"
    | "meal"
    | "break"
    | "off"
    | "firstClock"
    /** Came in again with no exit since the last entry: an exit was missed. */
    | "reentry"
    /** Left again with no entry since the last exit: an entry was missed. */
    | "reexit";
  /** Null for a first of the day, which has nothing before it. */
  minutes: number | null;
  /** For a missed scan: the unmatched scan before it, ISO. */
  since?: string | null;
  /** Long enough to be worth a look: a meal or break over the limit. */
  long: boolean;
}

export interface ScanLogRow extends PresenceScan {
  /** What this scan means next to the one before it, when there is one. */
  context: ScanContext | null;
  /** The pipeline's own words when the time clock scan was not accepted. */
  rejectionReason: string | null;
  /**
   * A photo taken at this scan. Always null: the tablets keep one photo per
   * person, not one per scan, so the row shows `person.photoUrl`. Kept so a
   * per scan photo can drop in without reshaping the row.
   */
  photoUrl: string | null;
  person: {
    id: string;
    name: string;
    employeeCode: string;
    department: string | null;
    jobTitle: string | null;
    /** The site on their record, when it is not this building. */
    homeSite: string | null;
    photoUrl: string | null;
  };
}

export interface ScanLogSummary {
  gateIn: number;
  gateOut: number;
  gateTotal: number;
  clockIn: number;
  clockOut: number;
  clockTotal: number;
  /** Scans that never counted: refused by the timecard, or a reader's repeat read. */
  rejected: number;
  /** Gate exits the system wrote overnight for people who never scanned out. */
  gateAutoClosed: number;
  /** Time clock outs the system wrote overnight for people who never clocked out. */
  clockAutoClosed: number;
  /** Different people seen at either reader today. */
  people: number;
  /** Different people who came in through the gate at least once, each counted once. */
  peopleIn: number;
  /** Different people who clocked in at least once, each counted once. */
  peopleClockedIn: number;
  /**
   * Gate scans with no partner: an entry after an entry, or an exit after an
   * exit. The reason gate ins minus outs can differ from who is inside.
   */
  missedGate: number;
}

export interface ScanLogPage {
  /** The site's calendar day the log covers, and today's, YYYY-MM-DD. */
  day: string;
  today: string;
  rows: ScanLogRow[];
  /** More rows exist further back than the ones returned. */
  hasMore: boolean;
  summary: ScanLogSummary;
  /**
   * The newest time any matching scan was recorded. The next poll asks for
   * rows recorded after it, by arrival rather than by scan time, so a tablet
   * that was offline and posts its queue late still lands in the log.
   */
  watermark: string | null;
}

/* ── Movements: one site, one day, everybody ───────────────────────────── */

/** Somebody the day concerns: scanned, scheduled, or on approved leave. */
export interface DayPerson {
  id: string;
  name: string;
  employeeCode: string;
  departmentId: string | null;
  department: string | null;
  /** Their job title, or null. What the board shows under a name, so the
   *  card and the panel describe someone the same way. */
  jobTitle: string | null;
  shiftId: string | null;
  shift: string | null;
  /** A signed link to the tablet photo, or null. */
  photoUrl: string | null;
  /** Paid a salary, so not expected to use the time clock. */
  salaried: boolean;
  inactive: boolean;
  /** That day's schedule in site time, HH:mm. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  onLeave: boolean;
  /** The site on their record, when it is not this building: they scanned here from elsewhere. */
  homeSite: string | null;
}

/**
 * Everything that happened at one site on one day, as it was recorded. The
 * browser turns it into movements with the same lane logic the person panel
 * uses, so a line in the table and a stretch on the panel's lanes are always
 * the same stretch, and the open ones keep counting between refreshes.
 */
export interface SiteDay {
  site: { id: string; name: string; timezone: string; hasGateData: boolean };
  day: string;
  today: string;
  dayStart: string;
  dayEnd: string;
  generatedAt: string;
  /** The newest time any of the day's scans was recorded, for "has anything changed". */
  watermark: string | null;
  people: DayPerson[];
  /** Each person's scans that day, oldest first, keyed by person id. */
  scans: Record<string, PresenceScan[]>;
  /** Each person's last scan of each kind before the day, which sets where it starts. */
  carry: Record<string, { gate: PresenceScan | null; clock: PresenceScan | null }>;
  /** The day held more scans than one answer carries; the oldest were left out. */
  truncated: boolean;
}
