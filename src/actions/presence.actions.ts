"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { getPresenceBoard, getPresenceDetail, getViewableSites } from "@/lib/presence/on-site.service";
import { getScanLog, type ScanLogInput } from "@/lib/presence/scan-log.service";

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
      departmentId: text(input.departmentId),
      shiftId: text(input.shiftId),
      q: text(input.q),
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
