export const SUPER_ADMIN_TENANT_COOKIE = "super_admin_tenant_id";
export const VIEW_AS_ROLE_COOKIE = "view_as_role";

/**
 * Where a page sends someone whose session the full check in auth.ts has just
 * ended (password reset, company switched off, login removed). The proxy does
 * not read the database, so it still sees a valid cookie and would bounce
 * /login straight back to the page, which bounced to /login: a redirect loop.
 * With this flag the proxy clears the cookie and shows the sign in page.
 */
export const SESSION_ENDED_HREF = "/login?ended=1";

/** The main page of a role limited to Live Attendance. */
export const LIVE_ATTENDANCE_HREF = "/supervisor/on-site";

/** The Knowledge Base: guides from the ticketing system, read only. */
export const KNOWLEDGE_BASE_HREF = "/knowledge-base";

/**
 * Every page a role limited to Live Attendance (Loss Prevention) can open:
 * Live Attendance, the Knowledge Base so their own guides reach them, and
 * their own badge, which shows nobody's data but theirs. The portal layout
 * redirects anything else to Live Attendance.
 */
export const LIVE_ATTENDANCE_ONLY_HREFS = [LIVE_ATTENDANCE_HREF, KNOWLEDGE_BASE_HREF, "/badge"];

/**
 * The address being opened, set by the route guard on every portal request so
 * the portal layout can enforce a page limit on the server. Always overwritten
 * there, so a value a browser sends is never the one read.
 */
export const REQUEST_PATH_HEADER = "x-ct-path";
