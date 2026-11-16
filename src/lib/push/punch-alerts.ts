import { db } from "@/lib/db";
import { PUNCH_TYPE_LABEL, type PunchTypeValue } from "@/lib/state-machines/labels";
import { emailUsers, punchMoment, type ApprovalEmail } from "@/lib/notify/approval-email";
import { personTimeZone } from "@/lib/utils/person-time-zone";
import { pushToUsers } from "./send";

/**
 * The two missed punch notifications, the same shape as the leave ones
 * (leave-alerts.ts):
 *
 * <p>a missed punch an employee reports goes to their own supervisor, who
 * approves or rejects it on Exceptions; and the decision goes back to the
 * person who reported it.
 *
 * <p>Each one also goes out as an email, with the punch's details
 * (lib/notify/approval-email.ts).
 *
 * <p>Called after the change is saved, never before. Each one only ever
 * sends; a failure is logged and nothing else happens.
 */

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Someone";
}

function fullName(name: string | null | undefined): string {
  return name?.trim() || "An employee";
}

/** "Clock Out", as a row label shows it. */
function punchLabel(punchType: string): string {
  return PUNCH_TYPE_LABEL[punchType as PunchTypeValue] ?? "Punch";
}

type Reported = NonNullable<Awaited<ReturnType<typeof punchWithOwner>>>;

/** The rows every missed punch email shows: the person (when it is not them), the punch, its time on their clock. */
function punchDetails(p: Reported, withName: boolean): [string, string][] {
  return [
    ...(withName ? ([["Employee", fullName(p.employee.user?.name)]] as [string, string][]) : []),
    ["Punch", punchLabel(p.punchType)],
    ["Time", punchMoment(p.punchTime, personTimeZone(p.employee))],
  ];
}

async function tell(userIds: string[], push: Parameters<typeof pushToUsers>[1], email: ApprovalEmail): Promise<void> {
  await Promise.all([pushToUsers(userIds, push), emailUsers(userIds, email)]);
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
      punchTime: true,
      note: true,
      source: true,
      isApproved: true,
      isRejected: true,
      employee: {
        select: {
          userId: true,
          timeZone: true,
          site: { select: { timezone: true } },
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
  const name = fullName(punch.employee.user?.name);
  const note = punch.note?.trim();
  await tell(
    [supervisor.userId],
    {
      title: "Missed punch request",
      body: `${firstName(punch.employee.user?.name)} reported a missed ${punchWords(punch.punchType)}. Tap to review it.`,
      href: "/supervisor/exceptions",
    },
    {
      subject: `Missed punch request from ${name}`,
      heading: "Missed punch request",
      line: `${name} reported a missed ${punchWords(punch.punchType)}. It is waiting for your approval.`,
      details: [...punchDetails(punch, true), ...(note ? ([["Note", note]] as [string, string][]) : [])],
      button: "Review request",
      href: "/supervisor/exceptions",
    },
  );
}

/** A missed punch request was just approved or rejected: the person who reported it. */
export async function alertMissedPunchDecided(punchId: string): Promise<void> {
  const punch = await punchWithOwner(punchId).catch(() => null);
  if (!punch?.employee.userId) return;
  const what = punchWords(punch.punchType);
  if (punch.isApproved) {
    await tell(
      [punch.employee.userId],
      { title: "Missed punch approved", body: `Your missed ${what} was approved and added to your timecard.`, href: "/time/history" },
      {
        subject: `Your missed ${what} was approved`,
        heading: "Missed punch approved",
        line: `Your missed ${what} was approved and added to your timecard.`,
        details: punchDetails(punch, false),
        button: "View my punches",
        href: "/time/history",
      },
    );
  } else if (punch.isRejected) {
    await tell(
      [punch.employee.userId],
      {
        title: "Missed punch not approved",
        body: `Your missed ${what} request was not approved. Talk to your supervisor about it.`,
        href: "/time/history",
      },
      {
        subject: `Your missed ${what} request was not approved`,
        heading: "Missed punch not approved",
        line: `Your missed ${what} request was not approved. Talk to your supervisor about it.`,
        details: punchDetails(punch, false),
        button: "View my punches",
        href: "/time/history",
      },
    );
  }
}
