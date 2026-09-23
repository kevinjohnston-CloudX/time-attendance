import type { PresenceScan } from "./types";

/**
 * Which scans On Site shows and counts. One rule, used by every view, so a
 * total at the top of the page and the list under a person always agree.
 *
 * <p>A time clock scan counts when the timecard turned it into a punch. One it
 * refused (in practice, nearly always "scanned again too quickly"), one that
 * errored, and one still pending never reached anybody's hours, so it is not
 * shown. Neither is a second read of the same badge that a reader marked as a
 * repeat. Both stay reachable in the Scan log under "Not counted".
 *
 * <p>A row the system wrote (the overnight close) is shown, labelled as such,
 * because "nobody scanned out" is exactly what loss prevention asks about. It
 * is not counted as a scan, because nobody scanned.
 */

/** Time clock outcomes that never became a punch. */
export const NOT_COUNTED_OUTCOMES = ["PUNCH_REJECTED", "ERROR", "PENDING"] as const;

/** Shown in lists and on the ribbon. */
export function isShownScan(s: PresenceScan): boolean {
  return !s.rejected && !s.reread;
}

/** Counted in every total: a real scan at a reader that the system kept. */
export function isCountedScan(s: PresenceScan): boolean {
  return isShownScan(s) && !s.automatic;
}
