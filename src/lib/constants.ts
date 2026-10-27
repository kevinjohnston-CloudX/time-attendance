export const SUPER_ADMIN_TENANT_COOKIE = "super_admin_tenant_id";
export const VIEW_AS_ROLE_COOKIE = "view_as_role";

/** The main page of a role limited to Live Attendance. */
export const LIVE_ATTENDANCE_HREF = "/supervisor/on-site";

/** The Knowledge Base: guides from the ticketing system, read only. */
export const KNOWLEDGE_BASE_HREF = "/knowledge-base";

/**
 * Every page a role limited to Live Attendance (Loss Prevention) can open:
 * Live Attendance, and the Knowledge Base so their own guides reach them.
 * The portal layout redirects anything else to Live Attendance.
 */
export const LIVE_ATTENDANCE_ONLY_HREFS = [LIVE_ATTENDANCE_HREF, KNOWLEDGE_BASE_HREF];

/**
 * The address being opened, set by the route guard on every portal request so
 * the portal layout can enforce a page limit on the server. Always overwritten
 * there, so a value a browser sends is never the one read.
 */
export const REQUEST_PATH_HEADER = "x-ct-path";
