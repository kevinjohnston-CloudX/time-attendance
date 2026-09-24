"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { getPresenceBoard, getPresenceDetail, getViewableSites } from "@/lib/presence/on-site.service";
import { getScanLog, type ScanLogInput } from "@/lib/presence/scan-log.service";
import { getSiteDay } from "@/lib/presence/movements.service";
import { MAX_PHOTO_BYTES, savePhoto } from "@/lib/presence/photos";
import { writeAuditLog } from "@/lib/audit/logger";
import { MAX_PICKED, peopleByIds, resolveNames, suggestPeople } from "@/lib/presence/people-search.service";

/**
 * On Site: who is in the building right now.
 *
 * <p>Gated on PRESENCE_VIEW_ANY, which HR admins hold and system admins get
 * with everything else. A regular employee or a supervisor without it gets
 * FORBIDDEN from both actions, whatever the browser shows. The board says
 * where every person at a site is at this moment, so there is deliberately no
 * team or own scope: somebody either may see the building or may not.
 *
 * <p>The site is checked against the viewer's own list on every call, not just
 * on page load, because the board polls with whatever id the browser sends.
 * An id outside that list answers NOT_FOUND, the same as one that does not
 * exist.
 */

/** Ids from the browser, kept only when they look like ids, and never more than a search holds. */
function idList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const ids = v.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x)).slice(0, MAX_PICKED);
  return ids.length ? ids : null;
}

async function assertSite(tenantId: string, viewer: { employeeId: string; role: string }, siteId: string) {
  const sites = await getViewableSites(tenantId, viewer);
  if (!sites.some((s) => s.id === siteId)) throw new Error("NOT_FOUND");
}

/**
 * The sites this viewer may open, and which one to open first: their own
 * building when they are allowed to see it, otherwise the first by name.
 */
export const getOnSiteSites = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, employeeId, role }) => {
    if (!tenantId) return { sites: [], defaultSiteId: null as string | null };
    const sites = await getViewableSites(tenantId, { employeeId, role });
    const own = employeeId
      ? await db.employee.findFirst({ where: { id: employeeId, tenantId }, select: { siteId: true } })
      : null;
    const defaultSiteId = sites.find((s) => s.id === own?.siteId)?.id ?? sites[0]?.id ?? null;
    return { sites: sites.map((s) => ({ id: s.id, name: s.name })), defaultSiteId };
  },
);

export const getOnSiteBoard = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, employeeId, role }, input: { siteId: string }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    await assertSite(tenantId, { employeeId, role }, input.siteId);
    const board = await getPresenceBoard(tenantId, input.siteId);
    if (!board) throw new Error("NOT_FOUND");
    return board;
  },
);

export const getOnSitePerson = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, employeeId, role }, input: { siteId: string; employeeId: string; day?: string | null }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    await assertSite(tenantId, { employeeId, role }, input.siteId);
    const detail = await getPresenceDetail(
      tenantId,
      input.siteId,
      input.employeeId,
      typeof input.day === "string" ? input.day : null,
    );
    if (!detail) throw new Error("NOT_FOUND");
    return detail;
  },
);

/**
 * Today's scan log at one site, from the gate and the time clock. The same
 * gate and the same site check as the board: it shows the same people, one
 * event at a time instead of one status each.
 *
 * <p>Everything the browser sends is re-read into a known shape here, so an
 * unexpected value narrows to nothing rather than reaching the query.
 */
export const getOnSiteScanLog = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, employeeId, role }, input: { siteId: string } & ScanLogInput) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    await assertSite(tenantId, { employeeId, role }, input.siteId);
    const text = (v: unknown, max = 100) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
    const log = await getScanLog(tenantId, input.siteId, {
      day: text(input.day, 10),
      stream: input.stream === "SECURITY" || input.stream === "TIME_CLOCK" ? input.stream : null,
      direction: input.direction === "IN" || input.direction === "OUT" ? input.direction : null,
      rejected: input.rejected === true,
      first: input.first === "gate" || input.first === "clock" ? input.first : null,
      missed: input.missed === true,
      departmentId: text(input.departmentId),
      shiftId: text(input.shiftId),
      q: text(input.q),
      ids: idList(input.ids),
      before:
        input.before && iso(input.before.at) && text(input.before.id)
          ? { at: input.before.at, id: input.before.id }
          : null,
      since: iso(input.since),
      limit: typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : undefined,
    });
    if (!log) throw new Error("NOT_FOUND");
    return log;
  },
);

/**
 * One site's whole day for the Movements view: everybody scheduled, on leave
 * or seen, with every scan they made. The same gate and site check as the
 * board. With `since`, answers `{ unchanged: true }` when nothing new has been
 * recorded, so the poll costs one small query most of the time.
 */
export const getOnSiteMovements = withRBAC(
  "PRESENCE_VIEW_ANY",
  async (
    { tenantId, employeeId, role },
    input: { siteId: string; day?: string | null; since?: { watermark: string | null; generatedAt: string } | null },
  ) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    await assertSite(tenantId, { employeeId, role }, input.siteId);
    const since =
      input.since && typeof input.since.generatedAt === "string" && !Number.isNaN(Date.parse(input.since.generatedAt))
        ? {
            watermark: typeof input.since.watermark === "string" ? input.since.watermark : null,
            generatedAt: input.since.generatedAt,
          }
        : null;
    const day = await getSiteDay(tenantId, input.siteId, {
      day: typeof input.day === "string" ? input.day.slice(0, 10) : null,
      since,
    });
    if (!day) throw new Error("NOT_FOUND");
    return day;
  },
);

/**
 * Replaces a person's time clock photo, from the employee panel.
 *
 * <p>Gated on PRESENCE_PHOTO_EDIT, which is "Live Attendance, Write" on the
 * Roles page: system admins hold it with everything, HR admins by default,
 * and any other role only when an admin ticks it. Anyone else gets FORBIDDEN,
 * whatever the browser shows. The site is checked like every other action
 * here, and the person is looked up inside the caller's tenant, so an id from
 * elsewhere answers NOT_FOUND.
 *
 * <p>The browser crops and shrinks the photo before sending it; this only
 * checks it is a JPEG of a sensible size and files it. Every change is in the
 * audit log with who made it, and the bucket keeps the photo it replaced.
 */
export const updateEmployeePhoto = withRBAC("PRESENCE_PHOTO_EDIT", async ({ tenantId, employeeId, role }, form: FormData) => {
  if (!tenantId) throw new Error("NOT_FOUND");
  const siteId = form.get("siteId");
  const personId = form.get("employeeId");
  const photo = form.get("photo");
  if (typeof siteId !== "string" || typeof personId !== "string") throw new Error("NOT_FOUND");
  if (!(photo instanceof Blob) || photo.size === 0) throw new Error("PHOTO_TYPE");
  if (photo.size > MAX_PHOTO_BYTES) throw new Error("PHOTO_SIZE");

  await assertSite(tenantId, { employeeId, role }, siteId);
  const person = await db.employee.findFirst({
    where: { id: personId, tenantId },
    select: { id: true, barcode: true, wmsId: true, employeeCode: true },
  });
  if (!person) throw new Error("NOT_FOUND");

  const saved = await savePhoto(tenantId, person, new Uint8Array(await photo.arrayBuffer()));
  await writeAuditLog({
    tenantId,
    actorId: employeeId || null,
    action: "EMPLOYEE_PHOTO_UPDATED",
    entityType: "EMPLOYEE",
    entityId: person.id,
    changes: {
      file: saved.key,
      version: saved.versionId,
      replacedVersion: saved.previousVersionId,
      bytes: photo.size,
      siteId,
    },
  });
  return { photoUrl: saved.url };
});

/**
 * The search box that holds several people: suggestions while typing, a
 * pasted list of names, and people restored from a link. The same gate and
 * site check as the board, and only people this site's pages could show
 * (based here, or scanned here in the last week) are ever returned.
 */
export const findOnSitePeople = withRBAC(
  "PRESENCE_VIEW_ANY",
  async (
    { tenantId, employeeId, role },
    input: { siteId: string; q?: string; names?: string[]; ids?: string[]; exclude?: string[] },
  ) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    await assertSite(tenantId, { employeeId, role }, input.siteId);
    if (Array.isArray(input.names)) {
      const names = input.names.filter((n): n is string => typeof n === "string").slice(0, MAX_PICKED);
      return { kind: "names" as const, ...(await resolveNames(tenantId, input.siteId, names)) };
    }
    const ids = idList(input.ids);
    if (ids) return { kind: "ids" as const, people: await peopleByIds(tenantId, input.siteId, ids) };
    const q = typeof input.q === "string" ? input.q.slice(0, 80) : "";
    return { kind: "suggest" as const, people: await suggestPeople(tenantId, input.siteId, q, idList(input.exclude) ?? []) };
  },
);
