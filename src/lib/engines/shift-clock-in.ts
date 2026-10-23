/**
 * Which clock in a pay code chosen on a timecard line belongs to.
 *
 * <p>A worked line's code is stored on the clock in that started its shift, so
 * it survives the next recalculation. It used to go to the latest clock in at
 * or before the line, whatever that was: for a leave line (manual leave hours,
 * a leave request), which has no punch of its own and starts at a nominal 9 AM,
 * that was the previous working day's clock in. Unpaid Time Off entered for a
 * Call Out on 9/22 turned Anali Galan's 9/21 afternoon unpaid; 33 clock ins
 * took a later day's code that way.
 *
 * <p>Now only a worked line made from punches has a clock in: the last one at
 * or before it with no clock out in between, on the same shift (within 24
 * hours). Leave lines, and salary or auto-pay hours (from midnight, no punch),
 * have none; their code is the day's code.
 */
export type ShiftPunch = { id: string; punchType: string; roundedTime: Date };

export function shiftClockIn(
  line: { segmentType: string; startTime: Date; segmentDate: Date },
  punches: ShiftPunch[],
): string | null {
  if (line.segmentType !== "WORK") return null;
  if (line.startTime.getTime() === line.segmentDate.getTime()) return null; // a credit from midnight, no punch
  const at = line.startTime.getTime();
  const before = punches
    .filter((p) => p.roundedTime.getTime() <= at && (p.punchType === "CLOCK_IN" || p.punchType === "CLOCK_OUT"))
    .sort((a, b) => b.roundedTime.getTime() - a.roundedTime.getTime());
  const last = before[0];
  if (!last || last.punchType !== "CLOCK_IN") return null; // the shift ended before this line
  if (at - last.roundedTime.getTime() > 24 * 60 * 60 * 1000) return null;
  return last.id;
}

/**
 * A clock in still open (no clock out after it) that starts on the given
 * calendar day: where a code set on a day with no hours yet is kept until its
 * clock out arrives. One already closed belongs to its own shift's line.
 */
export function openClockInOnDay(dayStart: Date, punches: ShiftPunch[]): string | null {
  const dayEnd = dayStart.getTime() + 24 * 60 * 60 * 1000;
  const sorted = [...punches].sort((a, b) => a.roundedTime.getTime() - b.roundedTime.getTime());
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    if (p.punchType !== "CLOCK_IN") continue;
    const t = p.roundedTime.getTime();
    if (t < dayStart.getTime() || t >= dayEnd) continue;
    return sorted[i + 1]?.punchType === "CLOCK_OUT" ? null : p.id;
  }
  return null;
}
