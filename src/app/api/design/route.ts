import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { isLiveAttendanceOnly } from "@/lib/rbac/permission-resolver";
import { saveDesign, savedDesign } from "@/lib/design-preference";
import {
  DEFAULT_DESIGN,
  DESIGN_COOKIE,
  DESIGN_COOKIE_MAX_AGE,
  DESIGN_SWITCH_PARAM,
  DESIGN_SWITCH_VALUE,
  classicOffered,
  parseDesign,
  safeNext,
  type Design,
} from "@/lib/design-switch";

/**
 * Sets the design for this browser, and for the signed-in person, then
 * continues to `next`. It is a plain address so a link can switch design (the
 * classic menu's Live Attendance, a page Classic does not have) and so sign in
 * can pass through it on the way to the dashboard.
 *
 *   ?to=classic|new&next=/path   pick a design; saved to the person when signed in
 *   ...&remember=0               this browser only (a page Classic lacks opened in New)
 *   ?sync=1&next=/path           after sign in: set this browser to the saved design
 *
 * Who may call it: anyone signed in, deliberately (the proxy sends everyone
 * else to sign in first). It only ever writes the caller's own design: their
 * row, found from their session, never from the request. A role limited to
 * Live Attendance always gets New, since Classic has no such limit, and after
 * Classic's last day everyone does. `next` must be a path on this site.
 */

const PRIVILEGED_ROLES = ["SYSTEM_ADMIN", "SUPER_ADMIN"];

/**
 * A redirect to a path on this site, sent as the path alone. Next writes
 * 127.0.0.1 as "localhost" in a full address, which moved a browser on
 * 127.0.0.1 to localhost, where it is not signed in.
 */
function goTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const next = safeNext(params.get("next"));
  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Whether this person can be on Classic at all.
  const role = session?.user?.role ?? "EMPLOYEE";
  const limited =
    !!session?.user && !PRIVILEGED_ROLES.includes(role) && (await isLiveAttendanceOnly(session.user.customRoleId));
  const canClassic = classicOffered() && !limited;

  let design: Design;
  if (params.get("sync") === "1") {
    if (!userId) return goTo(next);
    design = canClassic ? ((await savedDesign(userId)) ?? DEFAULT_DESIGN) : "new";
  } else {
    const wanted = parseDesign(params.get("to"));
    if (!wanted) return goTo(next);
    design = wanted === "classic" && !canClassic ? "new" : wanted;
    if (userId && params.get("remember") !== "0") await saveDesign(userId, design);
  }

  const target = new URL(next, req.nextUrl);
  // Arrived by the switch: if the design just picked has no such page, its not
  // found screen steps up to one it has rather than switching straight back.
  if (params.get(DESIGN_SWITCH_PARAM) === DESIGN_SWITCH_VALUE) {
    target.searchParams.set(DESIGN_SWITCH_PARAM, DESIGN_SWITCH_VALUE);
  }
  const res = goTo(`${target.pathname}${target.search}`);
  res.cookies.set(DESIGN_COOKIE, design, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: req.nextUrl.protocol === "https:",
    maxAge: DESIGN_COOKIE_MAX_AGE,
  });
  return res;
}
