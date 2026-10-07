import { getSiteTablets } from "@/actions/tablets.actions";
import { presenceRead } from "@/lib/presence/read-route";

/** GET /api/presence/tablets?input={siteId}. The Tablets window and its warning, checked by getSiteTablets (see read-route.ts). */
export const dynamic = "force-dynamic";
export const GET = presenceRead(getSiteTablets);
