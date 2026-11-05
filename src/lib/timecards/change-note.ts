import { db } from "@/lib/db";

/**
 * A note on the day someone changed on a timecard: what they added, changed
 * or removed, and the note they gave with it, under their name. The day's
 * notes are where HR looks to see why a day reads the way it does; a change
 * used to leave its note on the leave or punch behind it, and the day showed
 * none (Kathleen Marquart's Jury Duty on 10/11, entered with "Summon filed in
 * HR"). Meal waivers write theirs the same way (timesheet.actions).
 *
 * <p>Written after the change is saved. A note that fails is logged and left:
 * the change itself stands.
 */
export async function noteTimecardChange(o: {
  timesheetId: string;
  /** The day changed, "yyyy-MM-dd". */
  day: string;
  actorId: string | null | undefined;
  /** What was done, e.g. "Added 8.00 h Jury Duty". */
  change: string;
  /** What the person typed with it, if anything. */
  note?: string | null;
}): Promise<void> {
  try {
    const by = o.actorId
      ? await db.employee.findUnique({ where: { id: o.actorId }, select: { user: { select: { name: true } }, employeeCode: true } })
      : null;
    const typed = o.note?.trim();
    const noteDate = new Date(`${o.day}T00:00:00.000Z`);
    const note = typed ? `${o.change}. ${typed}` : o.change;
    const createdById = o.actorId ?? "system";
    // Once: a day's pay code is saved line by line, the same change for each.
    const same = await db.timesheetNote.findFirst({
      where: { timesheetId: o.timesheetId, noteDate, note, createdById, createdAt: { gte: new Date(Date.now() - 60_000) } },
      select: { id: true },
    });
    if (same) return;
    await db.timesheetNote.create({
      data: { timesheetId: o.timesheetId, noteDate, note, createdById, createdByName: by?.user?.name ?? by?.employeeCode ?? "System" },
    });
  } catch (err) {
    console.error("[change-note] could not note a timecard change", err);
  }
}

/** A moment as the clock at the site showed it, "8:06 AM". */
export function clockAt(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
}

/** A moment's calendar day at the site, "yyyy-MM-dd". */
export function dayAt(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
}

/** Hours to two places, "8.00 h". */
export function hoursLabel(hours: number): string {
  return `${hours.toFixed(2)} h`;
}
