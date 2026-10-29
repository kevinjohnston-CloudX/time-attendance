import type { Prisma } from "@prisma/client";

/**
 * Badges CloudTime issues itself, to people from client companies who come
 * into a building. They badge the security gate like anybody else — photo,
 * IN and OUT, On Site, the nightly close — but work no shift and keep no
 * timecard.
 *
 * <p><b>Why a prefix.</b> Every other badge comes from the WMS, which numbers
 * people and cards with digits only: on 2026-10-28 no badge, card or roster
 * row in CloudTime started with CL, and no WMS card carried a letter at all. A
 * badge that starts with letters can therefore never collide with a WMS one,
 * now or later. That matters beyond CloudTime: a US gate also sends every
 * scan it accepts on to Oracle, which looks the code up among WMS cards. A
 * client's code matches none, so Oracle writes nothing (the insert into
 * timestationscanlog needs an employee number and fails into the controller's
 * catch, and the tablet marks the write refused); a digits-only code that
 * happened to be somebody's card would file the client's crossing under that
 * employee. The keypad is digits only, so a client badge is always a card —
 * QR or Code 128, both of which the tablets read.
 *
 * <p><b>How one is issued.</b> "CL" given as the Badge ID when a person is
 * added or edited (or as a CSV row's wmsId) is replaced by the next number:
 * CL00001, CL00002, and so on. Next means one past the highest ever used — on
 * any person in any company, since Badge IDs are unique across all of them,
 * or seen in any scan — so a card once handed out is never handed to somebody
 * else, even after its record changed.
 *
 * <p><b>What a client badge changes.</b> The gate admits it without a
 * schedule (eligibility route), a time clock refuses it (punch route), the
 * tablets and the On Site pages show it as a Visitor whatever its department,
 * and holding one needs no sign in email. Nothing else.
 */
export const CLIENT_BADGE_PREFIX = "CL";

/** Digits after the prefix. Past CL99999 the number grows rather than wraps. */
const CLIENT_BADGE_DIGITS = 5;

const CLIENT_BADGE = new RegExp(`^${CLIENT_BADGE_PREFIX}(\\d+)$`);

/**
 * Stored as the scan's rejection reason and shown on the time clock. Builds
 * 163 to 166 draw it as the note under their own "Punch not recorded", so it
 * says what to do rather than repeating that.
 */
export const CLIENT_TIME_CLOCK_REJECTION = "Visitors scan at security only, not at the time clock";

/**
 * What the tablets and the On Site pages show as a client's department. Both
 * print the department beside the name, and the one a client is filed under is
 * whatever HR picked (on 2026-10-28 the first one read "Account Management" at
 * the gate), which says the wrong thing about who is walking in. The employee
 * record keeps the department as filed.
 */
export const CLIENT_DEPARTMENT_SHOWN = "Visitor";

/**
 * The department id the On Site pages file visitors under, so they group,
 * filter and export together rather than inside whatever department their
 * record names. Not a real department: no generated id looks like it.
 */
export const VISITOR_DEPARTMENT_ID = "visitors";

/** A badge CloudTime issued to a client. */
export function isClientBadge(code: string | null | undefined): boolean {
  return code != null && CLIENT_BADGE.test(code.trim());
}

/** "CL" alone, in any case: a request for the next client badge rather than a badge. */
export function asksForClientBadge(input: string | null | undefined): boolean {
  return input != null && input.trim().toUpperCase() === CLIENT_BADGE_PREFIX;
}

/** One past the highest client badge among these. Anything else is ignored. */
export function nextClientBadge(used: Iterable<string | null | undefined>): string {
  let highest = 0;
  for (const code of used) {
    const match = code ? CLIENT_BADGE.exec(code.trim()) : null;
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return CLIENT_BADGE_PREFIX + String(highest + 1).padStart(CLIENT_BADGE_DIGITS, "0");
}

/**
 * Issues the next client badge, inside the transaction that stores it. The
 * lock holds any other issue until that transaction ends, so two people added
 * at the same moment cannot be handed the same number.
 */
export async function issueClientBadge(tx: Prisma.TransactionClient): Promise<string> {
  // $executeRaw, not $queryRaw: the lock returns void, which a query cannot read back.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('client-badge'))`;
  return nextClientBadge(await clientBadgesInUse(tx));
}

/**
 * The badge the next visitor will get, for New Employee to show before it is
 * issued. Only a preview: the number is taken at the save, under the lock,
 * and is this one unless someone else was added in between.
 */
export async function previewClientBadge(client: Pick<Prisma.TransactionClient, "employee" | "scanEvent">): Promise<string> {
  return nextClientBadge(await clientBadgesInUse(client));
}

/** Every client badge on a person or seen in a scan. */
async function clientBadgesInUse(client: Pick<Prisma.TransactionClient, "employee" | "scanEvent">): Promise<(string | null)[]> {
  const people = await client.employee.findMany({
    where: {
      OR: [
        { wmsId: { startsWith: CLIENT_BADGE_PREFIX } },
        { employeeCode: { startsWith: CLIENT_BADGE_PREFIX } },
      ],
    },
    select: { wmsId: true, employeeCode: true },
  });
  const scanned = await client.scanEvent.findMany({
    where: { badgeCode: { startsWith: CLIENT_BADGE_PREFIX } },
    distinct: ["badgeCode"],
    select: { badgeCode: true },
  });
  return [...people.flatMap((p) => [p.wmsId, p.employeeCode]), ...scanned.map((s) => s.badgeCode)];
}
