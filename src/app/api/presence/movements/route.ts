import { getOnSiteMovements } from "@/actions/presence.actions";
import { presenceRead } from "@/lib/presence/read-route";

/** GET /api/presence/movements?input={siteId,day,since}. Movements and its export, checked by getOnSiteMovements (see read-route.ts). */
export const dynamic = "force-dynamic";
export const GET = presenceRead(getOnSiteMovements);
