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
 * schedule (eligibility route), a time clock refuses it (punch route), and
 * holding one needs no sign in email. Nothing else.
 */
export const CLIENT_BADGE_PREFIX = "CL";

/** Digits after the prefix. Past CL99999 the number grows rather than wraps. */
const CLIENT_BADGE_DIGITS = 5;

const CLIENT_BADGE = new RegExp(`^${CLIENT_BADGE_PREFIX}(\\d+)$`);

/**
 * Stored as the scan's rejection reason and shown on the time clock. Fixed
 * text, so the scan discrepancy job can recognise the rule working.
 */
export const CLIENT_TIME_CLOCK_REJECTION = "Client badges are for the security gate only, not the time clock";

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
  const people = await tx.employee.findMany({
    where: {
      OR: [
        { wmsId: { startsWith: CLIENT_BADGE_PREFIX } },
        { employeeCode: { startsWith: CLIENT_BADGE_PREFIX } },
      ],
    },
    select: { wmsId: true, employeeCode: true },
  });
  const scanned = await tx.scanEvent.findMany({
    where: { badgeCode: { startsWith: CLIENT_BADGE_PREFIX } },
    distinct: ["badgeCode"],
    select: { badgeCode: true },
  });
  return nextClientBadge([
    ...people.flatMap((p) => [p.wmsId, p.employeeCode]),
    ...scanned.map((s) => s.badgeCode),
  ]);
}
