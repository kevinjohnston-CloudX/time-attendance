import { getOnSiteBoard } from "@/actions/presence.actions";
import { presenceRead } from "@/lib/presence/read-route";

/** GET /api/presence/board?input={siteId}. The board's refresh, checked by getOnSiteBoard (see read-route.ts). */
export const dynamic = "force-dynamic";
export const GET = presenceRead(getOnSiteBoard);
