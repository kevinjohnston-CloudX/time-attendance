import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { localDateString } from "@/lib/presence/on-site.service";
import { SHIFT_HOURS_SELECT, shiftHoursOn } from "@/lib/presence/expected-hours";
import { photoUrls } from "@/lib/presence/photos";
import { gateLog } from "@/lib/presence/gate-alert-log";

/**
 * People CloudTime's gate check turned away for having no shift today, for
 * the alert on Live Attendance.
 *
 * <p>The gate check (/api/timeclock/eligibility) records each refusal after it
 * has answered the tablet. Live Attendance then shows loss prevention one card
 * per person with their photo and details, and they either dismiss it for the
 * day or add the person to today's schedule, so the next try lets them in.
 */

/** Why the gate check said no, as it answers the tablet. */
export type GateRefusalReason = "NO_SCHEDULE" | "NOT_A_WORKDAY";

/** More than a screen of cards is an outage, not a queue; the count still says how many. */
const MAX_OPEN = 50;

export interface GateRefusalCard {
  id: string;
  employeeId: string;
  name: string;
  employeeCode: string;
  jobTitle: string | null;
  department: string | null;
  supervisor: string | null;
  /** The site on their record, when it is not this building. */
  homeSite: string | null;
  /** The shift on their record, by name. */
  shift: string | null;
  /** That shift's hours today (or its usual hours when it cannot say), HH:mm. */
  usualStart: string | null;
  usualEnd: string | null;
  /** A signed link to the tablet photo, or null. */
  photoUrl: string | null;
  reason: GateRefusalReason;
  attempts: number;
  /** ISO. */
  firstAt: string;
  lastAt: string;
  device: string | null;
}

export interface GateRefusalQueue {
  /** The building's day, YYYY-MM-DD. */
  today: string;
  cards: GateRefusalCard[];
  /** Every open refusal today, including any past the cards returned. */
  total: number;
}

function workDateOf(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

async function siteDay(tenantId: string, siteId: string): Promise<{ today: string; workDate: Date } | null> {
  const site = await db.site.findFirst({ where: { id: siteId, tenantId }, select: { timezone: true } });
  if (!site) return null;
  const today = localDateString(new Date(), site.timezone || "America/New_York");
  return { today, workDate: workDateOf(today) };
}

/**
 * How long a gate scan still says which building somebody is standing at.
 * Long enough for walking out and turning back, which is how a person with no
 * shift usually meets the refusal once they are already on site; short enough
 * that a scan at one building is never read as a try at another across town.
 */
const RECENT_SCAN_MS = 10 * 60 * 1000;

type Placement = { site: { id: string; timezone: string }; placedBy: "tablet" | "last scan" | "home site" };

/**
 * Which building a refusal belongs to: the one the person was trying to get
 * into, never simply the site on their record.
 *
 * <p>In order: the warehouse number the tablet sent, the same rule every scan
 * follows (see site-scope.ts); else the building of their own gate scan in the
 * last {@link RECENT_SCAN_MS}, because the tablets do not send a number with
 * this check yet and somebody refused a few minutes after walking out is at
 * that door; else their own site, the only thing left to go on. Reads only.
 */
export async function placeGateRefusal(input: {
  tenantId: string;
  employeeId: string;
  homeSiteId: string | null;
  warehouse: string | null;
  at: Date;
}): Promise<Placement | null> {
  const bySite = async (code: string | null | undefined) =>
    code && /^\d{1,9}$/.test(code)
      ? db.site.findFirst({ where: { tenantId: input.tenantId, wmsWarehouseId: Number(code) }, select: { id: true, timezone: true } })
      : null;

  const fromTablet = await bySite(input.warehouse);
  if (fromTablet) return { site: fromTablet, placedBy: "tablet" };

  if (!input.warehouse) {
    // Arrival time on the server, not the tablet's clock, which can run a
    // minute either way; the scan time bound only lets the index narrow it.
    const last = await db.scanEvent.findFirst({
      where: {
        employeeId: input.employeeId,
        stream: "SECURITY",
        scanTime: { gte: new Date(input.at.getTime() - 60 * 60 * 1000) },
        createdAt: { gte: new Date(input.at.getTime() - RECENT_SCAN_MS), lte: input.at },
      },
      orderBy: { createdAt: "desc" },
      select: { site: true },
    });
    const fromScan = await bySite(last?.site);
    if (fromScan) return { site: fromScan, placedBy: "last scan" };
  }

  const home = input.homeSiteId
    ? await db.site.findFirst({ where: { tenantId: input.tenantId, id: input.homeSiteId }, select: { id: true, timezone: true } })
    : null;
  return home ? { site: home, placedBy: "home site" } : null;
}

/**
 * Keeps one refusal, at the building from {@link placeGateRefusal}. Another
 * try the same day adds to the count on the same row, and reopens it if they
 * had been added to the schedule since, because being turned away again means
 * that day is gone.
 */
export async function recordGateRefusal(input: {
  tenantId: string;
  employeeId: string;
  homeSiteId: string | null;
  warehouse: string | null;
  device: string | null;
  reason: GateRefusalReason;
  at: Date;
}): Promise<void> {
  const placed = await placeGateRefusal(input);
  if (!placed) {
    // Nowhere to show it: the tablet's warehouse number belongs to no site
    // and the person has no site on their record.
    gateLog("unplaced", { employee: input.employeeId, warehouse: input.warehouse, homeSite: input.homeSiteId }, "warn");
    return;
  }
  const { site, placedBy } = placed;

  const workDate = workDateOf(localDateString(input.at, site.timezone || "America/New_York"));
  const key = { employeeId_siteId_workDate: { employeeId: input.employeeId, siteId: site.id, workDate } };
  const write = () =>
    db.gateRefusal.upsert({
      select: { id: true, attempts: true, dismissedAt: true },
      where: key,
      create: {
        tenantId: input.tenantId,
        siteId: site.id,
        employeeId: input.employeeId,
        workDate,
        reason: input.reason,
        firstAt: input.at,
        lastAt: input.at,
        deviceName: input.device,
      },
      update: {
        attempts: { increment: 1 },
        lastAt: input.at,
        reason: input.reason,
        ...(input.device ? { deviceName: input.device } : {}),
        scheduledAt: null,
        scheduledById: null,
      },
    });
  let row: Awaited<ReturnType<typeof write>>;
  try {
    row = await write();
  } catch (err) {
    // Two readers answering the same badge at once both try to create the
    // row; the one that loses finds it there on a second go.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") row = await write();
    else throw err;
  }
  gateLog("noted", {
    refusal: row.id,
    employee: input.employeeId,
    site: site.id,
    placedBy,
    attempts: row.attempts,
    // Dismissed earlier today: counted, but no card shows again today.
    dismissedToday: row.dismissedAt ? true : undefined,
  });
}

/**
 * Today's refusals at one building that nobody has settled, oldest first, so
 * the card on screen stays put while others arrive. A person who has since
 * been scheduled (by WMS or anybody here) or has left the company drops out on
 * their own. The caller checks the viewer may see this building.
 */
export async function getOpenGateRefusals(tenantId: string, siteId: string): Promise<GateRefusalQueue | null> {
  const day = await siteDay(tenantId, siteId);
  if (!day) return null;
  const where: Prisma.GateRefusalWhereInput = {
    tenantId,
    siteId,
    workDate: day.workDate,
    dismissedAt: null,
    scheduledAt: null,
    employee: {
      isActive: true,
      terminatedAt: null,
      scheduleDays: { none: { workDate: day.workDate, isWorkday: true } },
    },
  };
  const [rows, total] = await Promise.all([
    db.gateRefusal.findMany({
      where,
      orderBy: { firstAt: "asc" },
      take: MAX_OPEN,
      select: {
        id: true,
        reason: true,
        attempts: true,
        firstAt: true,
        lastAt: true,
        deviceName: true,
        employee: {
          select: {
            id: true,
            employeeCode: true,
            jobTitle: true,
            barcode: true,
            wmsId: true,
            siteId: true,
            user: { select: { name: true } },
            department: { select: { name: true } },
            supervisor: { select: { user: { select: { name: true } } } },
            site: { select: { name: true } },
            shift: { select: { name: true, ...SHIFT_HOURS_SELECT } },
          },
        },
      },
    }),
    db.gateRefusal.count({ where }),
  ]);
  const photos = await photoUrls(
    tenantId,
    rows.map((r) => ({ id: r.employee.id, barcode: r.employee.barcode, wmsId: r.employee.wmsId, employeeCode: r.employee.employeeCode })),
  );

  const cards = rows.map((r): GateRefusalCard => {
    const e = r.employee;
    const shift = e.shift;
    // Today's hours when the shift says, else its usual hours: somebody off
    // today still has hours they normally work, and those fill the form.
    const today = shiftHoursOn(shift, day.today);
    const usual = today ?? (shift?.startTime && shift?.endTime ? { start: shift.startTime, end: shift.endTime } : null);
    return {
      id: r.id,
      employeeId: e.id,
      name: e.user?.name?.trim() || `Employee ${e.employeeCode}`,
      employeeCode: e.employeeCode,
      jobTitle: e.jobTitle,
      department: e.department?.name ?? null,
      supervisor: e.supervisor?.user?.name ?? null,
      homeSite: e.siteId && e.siteId !== siteId ? (e.site?.name ?? null) : null,
      shift: shift?.name ?? null,
      usualStart: usual?.start ?? null,
      usualEnd: usual?.end ?? null,
      photoUrl: photos.get(e.id) ?? null,
      reason: r.reason === "NOT_A_WORKDAY" ? "NOT_A_WORKDAY" : "NO_SCHEDULE",
      attempts: r.attempts,
      firstAt: r.firstAt.toISOString(),
      lastAt: r.lastAt.toISOString(),
      device: r.deviceName,
    };
  });
  return { today: day.today, cards, total };
}

/**
 * Settles refusals at one building as dismissed for the day, and says whose
 * they were. Only today's open ones at this building are touched, whatever ids
 * come in.
 */
export async function dismissGateRefusals(
  tenantId: string,
  siteId: string,
  ids: string[],
  actorId: string | null,
): Promise<{ id: string; employeeId: string }[]> {
  const day = await siteDay(tenantId, siteId);
  if (!day || !ids.length) return [];
  const where = { id: { in: ids }, tenantId, siteId, workDate: day.workDate, dismissedAt: null, scheduledAt: null };
  const open = await db.gateRefusal.findMany({ where, select: { id: true, employeeId: true } });
  if (!open.length) return [];
  await db.gateRefusal.updateMany({
    where: { ...where, id: { in: open.map((r) => r.id) } },
    data: { dismissedAt: new Date(), dismissedById: actorId },
  });
  return open;
}

/** Settles a person's refusal at one building today as added to the schedule. */
export async function markGateRefusalScheduled(
  tenantId: string,
  siteId: string,
  employeeId: string,
  actorId: string | null,
): Promise<void> {
  const day = await siteDay(tenantId, siteId);
  if (!day) return;
  await db.gateRefusal.updateMany({
    where: { tenantId, siteId, employeeId, workDate: day.workDate, scheduledAt: null },
    data: { scheduledAt: new Date(), scheduledById: actorId },
  });
}

/** For a Prisma where on employees: turned away at this building's gate today. */
export async function turnedAwayHereToday(tenantId: string, siteId: string): Promise<Prisma.EmployeeWhereInput | null> {
  const day = await siteDay(tenantId, siteId);
  if (!day) return null;
  return { gateRefusals: { some: { tenantId, siteId, workDate: day.workDate } } };
}
