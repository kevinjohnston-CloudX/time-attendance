import { getOnSiteUnknownBadges } from "@/actions/unknown-badges.actions";
import { presenceRead } from "@/lib/presence/read-route";

/** GET /api/presence/unknown-badges?input={siteId,day}. Unknown badges, checked by getOnSiteUnknownBadges (see read-route.ts). */
export const dynamic = "force-dynamic";
export const GET = presenceRead(getOnSiteUnknownBadges);
