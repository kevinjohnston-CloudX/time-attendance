"use server";

import { withRBAC } from "@/lib/rbac/guard";
import { getViewableSites } from "@/lib/presence/on-site.service";
import { getUnknownBadges } from "@/lib/presence/unknown-badges.service";

/**
 * Badges scanned at one building that match nobody, for Live Attendance.
 *
 * <p>The same gate as the rest of the page, PRESENCE_VIEW_ANY: whoever may see
 * who is in a building may see who walked into it without a record, and
 * nobody else. The site is checked against the viewer's own list on every
 * call, because the browser sends whatever id it likes, and an id outside the
 * list answers NOT_FOUND, the same as one that does not exist.
 *
 * <p>What it exposes beyond the rest of the page: the badge number, and the
 * name and department the WMS has for it. It is a read; nothing here writes.
 */
export const getOnSiteUnknownBadges = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, employeeId, role }, input: { siteId: string; day?: string | null }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const siteId = typeof input?.siteId === "string" ? input.siteId : "";
    const sites = await getViewableSites(tenantId, { employeeId, role });
    if (!sites.some((s) => s.id === siteId)) throw new Error("NOT_FOUND");

    const day = typeof input.day === "string" ? input.day.slice(0, 10) : null;
    const result = await getUnknownBadges(tenantId, siteId, day);
    if (!result) throw new Error("NOT_FOUND");
    return result;
  },
);
