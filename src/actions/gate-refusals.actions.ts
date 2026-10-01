"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { getViewableSites } from "@/lib/presence/on-site.service";
import { dismissGateRefusals, gateAlertsOnSince, getOpenGateRefusals } from "@/lib/presence/gate-refusals.service";
import { writeAuditLog } from "@/lib/audit/logger";
import { errorCode, gateLog } from "@/lib/presence/gate-alert-log";

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
 *
 * <p>Every failure is logged under "[gate-alert]" (see gate-alert-log.ts),
 * because the page answers a failed check with silence by design. A
 * successful check is not logged: the page asks every 15 seconds.
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
    try {
      if (!tenantId) throw new Error("NOT_FOUND");
      const siteId = await assertSite(tenantId, { employeeId, role }, input?.siteId);
      const queue = await getOpenGateRefusals(tenantId, siteId);
      if (!queue) throw new Error("NOT_FOUND");
      return queue;
    } catch (err) {
      gateLog("failed", { at: "list", viewer: employeeId, site: input?.siteId, error: errorCode(err) }, "warn");
      throw err;
    }
  },
);

export const dismissOnSiteGateRefusals = withRBAC(
  "PRESENCE_SCHEDULE_ADD",
  async ({ tenantId, employeeId, role }, input: { siteId: string; refusalIds: string[] }) => {
    try {
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
      gateLog("dismissed", { site: siteId, by: employeeId, count: dismissed.length, refusals: dismissed.map((r) => r.id).join(",") });
      return { dismissed: dismissed.length };
    } catch (err) {
      gateLog("failed", { at: "dismiss", viewer: employeeId, site: input?.siteId, error: errorCode(err) }, "warn");
      throw err;
    }
  },
);

/**
 * The company wide switch for the gate alert, in the Live Attendance header.
 *
 * <p>System Admins only (a super admin too, inside the company they are
 * working in), checked on the role in effect, so an admin viewing the app as
 * another role is refused like that role. Turning it off hides every card on
 * every Live Attendance screen within seconds; the gate and the record of each
 * refusal carry on as before. Turning it on shows only tries made from then
 * on. Every change goes in the audit log as a company settings change, which
 * is where the existing pay schedule changes are filed too.
 */
const ADMIN_ROLES = ["SYSTEM_ADMIN", "SUPER_ADMIN"];

export const getGateAlertsSetting = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, role }, _input: void) => {
    if (!tenantId || !ADMIN_ROLES.includes(role)) throw new Error("FORBIDDEN");
    const onSince = await gateAlertsOnSince(tenantId);
    return { onSince: onSince?.toISOString() ?? null };
  },
);

export const setGateAlerts = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, employeeId, role }, input: { on: boolean }) => {
    if (!tenantId || !ADMIN_ROLES.includes(role)) throw new Error("FORBIDDEN");
    const on = input?.on === true;
    const before = await gateAlertsOnSince(tenantId);
    // Already where it was asked to be: nothing to write, and "on since" keeps its time.
    if (on === (before !== null)) return { onSince: before?.toISOString() ?? null };
    const updated = await db.tenant.update({
      where: { id: tenantId },
      data: { gateAlertsOnSince: on ? new Date() : null },
      select: { gateAlertsOnSince: true },
    });
    await writeAuditLog({
      tenantId,
      actorId: employeeId || null,
      entityType: "PAY_PERIOD",
      entityId: tenantId,
      action: "SETTINGS_UPDATE",
      changes: { before: { gateAlerts: before ? "On" : "Off" }, after: { gateAlerts: on ? "On" : "Off" } },
    });
    gateLog("switched", { on, by: employeeId, tenant: tenantId });
    return { onSince: updated.gateAlertsOnSince?.toISOString() ?? null };
  },
);
