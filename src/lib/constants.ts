export const SUPER_ADMIN_TENANT_COOKIE = "super_admin_tenant_id";
export const VIEW_AS_ROLE_COOKIE = "view_as_role";

/** The one page a role limited to Live Attendance can open. */
export const LIVE_ATTENDANCE_HREF = "/supervisor/on-site";

/**
 * The address being opened, set by the route guard on every portal request so
 * the portal layout can enforce a page limit on the server. Always overwritten
 * there, so a value a browser sends is never the one read.
 */
export const REQUEST_PATH_HEADER = "x-ct-path";
