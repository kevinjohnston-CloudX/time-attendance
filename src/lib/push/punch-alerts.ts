import { db } from "@/lib/db";
import { PUNCH_TYPE_LABEL, type PunchTypeValue } from "@/lib/state-machines/labels";
import { pushToUsers } from "./send";

/**
 * The two missed punch notifications, the same shape as the leave ones
 * (leave-alerts.ts):
 *
 * <p>a missed punch an employee reports goes to their own supervisor, who
 * approves or rejects it on Exceptions; and the decision goes back to the
 * person who reported it.
 *
 * <p>Called after the change is saved, never before. Each one only ever
 * sends; a failure is logged and nothing else happens.
 */

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Someone";
}

/** "clock out", from the punch type, for the middle of a sentence. */
function punchWords(punchType: string): string {
  return (PUNCH_TYPE_LABEL[punchType as PunchTypeValue] ?? "punch").toLowerCase();
}

async function punchWithOwner(punchId: string) {
  return db.punch.findUnique({
    where: { id: punchId },
    select: {
      punchType: true,
      source: true,
      isApproved: true,
      isRejected: true,
      employee: {
        select: {
          userId: true,
          user: { select: { name: true } },
          supervisor: { select: { userId: true, isActive: true } },
        },
      },
    },
  });
}

/** A missed punch was just reported: the person's own supervisor. */
export async function alertMissedPunchRequested(punchId: string): Promise<void> {
  const punch = await punchWithOwner(punchId).catch(() => null);
  const supervisor = punch?.employee.supervisor;
  if (!punch || punch.source !== "MANUAL" || punch.isApproved || punch.isRejected) return;
  if (!supervisor?.isActive || !supervisor.userId) return;
  await pushToUsers([supervisor.userId], {
    title: "Missed punch request",
    body: `${firstName(punch.employee.user?.name)} reported a missed ${punchWords(punch.punchType)}. Tap to review it.`,
    href: "/supervisor/exceptions",
  });
}

/** A missed punch request was just approved or rejected: the person who reported it. */
export async function alertMissedPunchDecided(punchId: string): Promise<void> {
  const punch = await punchWithOwner(punchId).catch(() => null);
  if (!punch?.employee.userId) return;
  const what = punchWords(punch.punchType);
  if (punch.isApproved) {
    await pushToUsers([punch.employee.userId], {
      title: "Missed punch approved",
      body: `Your missed ${what} was approved and added to your timecard.`,
      href: "/time/history",
    });
  } else if (punch.isRejected) {
    await pushToUsers([punch.employee.userId], {
      title: "Missed punch not approved",
      body: `Your missed ${what} request was not approved. Talk to your supervisor about it.`,
      href: "/time/history",
    });
  }
}
