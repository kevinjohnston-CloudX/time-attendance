/**
 * The accrual history on the day each entry is for (11/09).
 *
 * <p>Leave taken came into the history on the day somebody entered it: PTO
 * for Monday 11/02 and Tuesday 11/03, put on the timecard on 11/09, read as
 * two "11/9/2026 Timecard entry -8h" lines and looked like the same day
 * entered twice. An entry made for a leave request now sits on the leave's
 * first day, and says when it was entered; everything else (accruals,
 * adjustments made by hand) stays on the day it was made.
 *
 * <p>Moving a row moves the balance beside it. Each balance is the one stored
 * with its entry, changed only by the entries that moved past it: one made
 * before it and now shown after takes its change back out, and one made
 * after it and now shown before puts its change in. Rows nothing moved past
 * keep their stored balance exactly, even where an import left the stored
 * balances not adding up.
 */

export type LedgerRow = {
  id: string;
  /** "yyyy-MM-dd": the day it is shown on. */
  date: string;
  deltaMinutes: number;
  /** The balance stored with the entry, in the order the entries were made. */
  runningBalance: number;
};

/** The day an entry is shown on: its leave's first day, or the day it was made. */
export function ledgerDay(createdAt: Date, leave: { startDate: Date } | null): string {
  return (leave ? leave.startDate : createdAt).toISOString().slice(0, 10);
}

function mdy(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/** What a moved entry adds to its detail: the leave's days when more than one, and when it was entered. */
export function ledgerDayNote(note: string | null, createdAt: Date, leave: { startDate: Date; endDate: Date } | null): string | null {
  if (!leave) return note;
  const first = leave.startDate.toISOString().slice(0, 10);
  const last = leave.endDate.toISOString().slice(0, 10);
  const made = createdAt.toISOString().slice(0, 10);
  const parts = [
    note,
    last > first ? `${mdy(first)} – ${mdy(last)}` : null,
    made !== first ? `entered ${mdy(made)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The rows in the order they are shown (by day, then as made), each with the
 * balance after it in that order. `rows` come in the order they were made.
 */
export function onLedgerDays<T extends LedgerRow>(rows: T[]): T[] {
  const made = rows.map((r, i) => ({ r, i }));
  const shown = [...made].sort((a, b) => (a.r.date !== b.r.date ? a.r.date.localeCompare(b.r.date) : a.i - b.i));
  const position = new Map(shown.map((s, p) => [s.i, p]));
  return shown.map(({ r, i }) => {
    const p = position.get(i)!;
    let balance = r.runningBalance;
    for (const o of made) {
      const q = position.get(o.i)!;
      if (o.i < i && q > p) balance -= o.r.deltaMinutes;
      else if (o.i > i && q < p) balance += o.r.deltaMinutes;
    }
    return { ...r, runningBalance: balance };
  });
}
