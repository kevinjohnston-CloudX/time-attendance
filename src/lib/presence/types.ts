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
 *   <li>NO_GATE_SCAN: on the clock, but the gate never saw them come in.</li>
 *   <li>LEFT: seen today, now out.</li>
 *   <li>ON_LEAVE: approved time off today, not seen.</li>
 *   <li>NOT_ARRIVED: scheduled today, not seen.</li>
 * </ul>
 */
export type PresenceStatus =
  | "WORKING"
  | "ON_MEAL"
  | "OFF_CLOCK"
  | "NO_GATE_SCAN"
  | "LEFT"
  | "ON_LEAVE"
  | "NOT_ARRIVED";

export interface PresencePerson {
  id: string;
  name: string;
  employeeCode: string;
  departmentId: string | null;
  department: string | null;
  shiftId: string | null;
  shift: string | null;
  /**
   * The tablet photo. Always null until the photo store is connected; the
   * board draws initials in the same frame, so connecting it changes nothing
   * else on the screen.
   */
  photoUrl: string | null;
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
  inactive: boolean;
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
  /** A site calendar day in the last week, YYYY-MM-DD. Null is today. */
  day: string | null;
  stream: ScanStream | null;
  direction: "IN" | "OUT" | null;
  rejected: boolean;
  departmentId: string | null;
  shiftId: string | null;
  q: string | null;
}

/** One reader event in the log, with the person it belongs to. */
export interface ScanLogRow extends PresenceScan {
  /** The pipeline's own words when the time clock scan was not accepted. */
  rejectionReason: string | null;
  /**
   * The photo the tablet took at this scan, once the photo store is
   * connected. Until then null, and the row shows the person's photo or
   * their initials in the same frame.
   */
  photoUrl: string | null;
  person: {
    id: string;
    name: string;
    employeeCode: string;
    department: string | null;
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
  /** Time clock scans the timecard did not accept. */
  rejected: number;
  /** Gate exits the system wrote overnight for people who never scanned out. */
  gateAutoClosed: number;
  /** Different people seen at either reader today. */
  people: number;
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
