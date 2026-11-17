"use server";

import { withRBAC } from "@/lib/rbac/guard";
import { getViewableSites } from "@/lib/presence/on-site.service";
import { getVisitorDay } from "@/lib/presence/visitor-day.service";

/**
 * One building's visitors on one day, for the Visitors panel on the Scan log.
 *
 * <p>The same gate as the rest of Live Attendance, PRESENCE_VIEW_ANY: whoever
 * may see who is in a building may see which visitors are allowed in and who
 * came. Renewing, ending and printing stay behind the Visitors permission in
 * visitor.actions.ts. The site is checked against the viewer's own list on
 * every call; one outside it answers NOT_FOUND, like one that does not exist.
 *
 * <p>What it shows beyond the rest of the page: each visitor's company, who
 * they are visiting and their pass dates. A read; nothing here writes.
 */
export const getOnSiteVisitors = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, employeeId, role }, input: { siteId: string; day?: string | null }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const siteId = typeof input?.siteId === "string" ? input.siteId : "";
    const sites = await getViewableSites(tenantId, { employeeId, role });
    if (!sites.some((s) => s.id === siteId)) throw new Error("NOT_FOUND");
    const day = typeof input.day === "string" ? input.day.slice(0, 10) : null;
    const result = await getVisitorDay(tenantId, siteId, day);
    if (!result) throw new Error("NOT_FOUND");
    return result;
  },
);
