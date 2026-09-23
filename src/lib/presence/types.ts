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
  scheduledStart: string | null;
  scheduledEnd: string | null;
  timezone: string;
  scans: PresenceScan[];
}
