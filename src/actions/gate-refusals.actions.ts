"use server";

import { withRBAC } from "@/lib/rbac/guard";
import { getViewableSites } from "@/lib/presence/on-site.service";
import { dismissGateRefusals, getOpenGateRefusals } from "@/lib/presence/gate-refusals.service";
import { writeAuditLog } from "@/lib/audit/logger";

/**
 * The gate alert on Live Attendance: who the gate turned away today for
 * having no shift, and dismissing them.
 *
 * <p>Gated on PRESENCE_SCHEDULE_ADD ("Live Attendance, Execute" on a role),
 * which is for the people who act on the alert, such as loss prevention. Being
 * able to see a building is not enough: the alert interrupts the page, so it
 * goes only to whoever is meant to answer it. Without the permission both
 * calls answer FORBIDDEN, whatever the browser shows.
 *
 * <p>The site is checked against the viewer's own list on every call, because
 * the page polls with whatever id the browser sends, and one outside that list
 * answers NOT_FOUND, the same as one that does not exist. A dismissal is
 * scoped by that site and today in the write itself, so an id from another
 * building or another day changes nothing.
 */

async function assertSite(tenantId: string, viewer: { employeeId: string; role: string }, siteId: unknown): Promise<string> {
  const id = typeof siteId === "string" ? siteId : "";
  const sites = await getViewableSites(tenantId, viewer);
  if (!sites.some((s) => s.id === id)) throw new Error("NOT_FOUND");
  return id;
}

export const getOnSiteGateRefusals = withRBAC(
  "PRESENCE_SCHEDULE_ADD",
  async ({ tenantId, employeeId, role }, input: { siteId: string }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const siteId = await assertSite(tenantId, { employeeId, role }, input?.siteId);
    const queue = await getOpenGateRefusals(tenantId, siteId);
    if (!queue) throw new Error("NOT_FOUND");
    return queue;
  },
);

export const dismissOnSiteGateRefusals = withRBAC(
  "PRESENCE_SCHEDULE_ADD",
  async ({ tenantId, employeeId, role }, input: { siteId: string; refusalIds: string[] }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const siteId = await assertSite(tenantId, { employeeId, role }, input?.siteId);
    const ids = Array.isArray(input.refusalIds)
      ? input.refusalIds.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x)).slice(0, 100)
      : [];
    if (!ids.length) throw new Error("NOT_FOUND");
    const dismissed = await dismissGateRefusals(tenantId, siteId, ids, employeeId || null);
    if (!dismissed.length) throw new Error("NOT_FOUND");
    await Promise.all(
      dismissed.map((r) =>
        writeAuditLog({
          tenantId,
          actorId: employeeId || null,
          action: "GATE_REFUSAL_DISMISSED",
          entityType: "EMPLOYEE",
          entityId: r.employeeId,
          changes: { refusalId: r.id, siteId, from: "Live Attendance" },
        }),
      ),
    );
    return { dismissed: dismissed.length };
  },
);
