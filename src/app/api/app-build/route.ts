import { NextResponse } from "next/server";
import { APP_BUILD_HEADER } from "@/lib/app-build";
import { servedBuild } from "@/lib/app-build.server";

/**
 * GET /api/app-build
 *
 * <p>Which build of CloudTime is being served right now, so a tab left open
 * can tell a newer one has been deployed (lib/app-build.ts). Asked when a tab
 * comes back into view and once a minute while it is in view.
 *
 * <p>Signed in only, through the proxy like every page, though there is
 * nothing private in it: the build key and nothing else. No database and no
 * session read, so the ask costs next to nothing.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const build = await servedBuild();
  return NextResponse.json({ build }, { headers: { "Cache-Control": "no-store", [APP_BUILD_HEADER]: build } });
}
