"use server";

import { auth } from "@/lib/auth";
import { withRBAC } from "@/lib/rbac/guard";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getViewableSites } from "@/lib/presence/on-site.service";
import { getBuildingTablets, type BuildingTablets } from "@/lib/presence/tablets.service";

/**
 * The Tablets window on Live Attendance: every tablet at one building, with
 * what each one reports about itself.
 *
 * <p>For the people who answer the gate alert (Live Attendance, Execute,
 * such as loss prevention) and for System Admins, checked here on the role in
 * effect rather than trusted from the page. The building must be on the
 * viewer's own list; any other answers NOT_FOUND, the same as one that does
 * not exist. Read only: nothing here changes a tablet.
 */
const ADMIN_ROLES = ["SYSTEM_ADMIN", "SUPER_ADMIN"];

export const getSiteTablets = withRBAC(
  "PRESENCE_VIEW_ANY",
  async ({ tenantId, employeeId, role }, input: { siteId: string }): Promise<BuildingTablets> => {
    if (!tenantId) throw new Error("FORBIDDEN");
    if (!ADMIN_ROLES.includes(role)) {
      const session = await auth();
      if (!session?.user || !(await userHasPermission(session.user, "PRESENCE_SCHEDULE_ADD"))) throw new Error("FORBIDDEN");
    }
    const siteId = typeof input?.siteId === "string" ? input.siteId : "";
    const viewable = await getViewableSites(tenantId, { employeeId, role });
    if (!viewable.some((s) => s.id === siteId)) throw new Error("NOT_FOUND");
    const result = await getBuildingTablets(tenantId, siteId);
    if (!result) throw new Error("NOT_FOUND");
    return result;
  },
);
