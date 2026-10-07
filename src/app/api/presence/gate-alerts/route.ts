import { getOnSiteGateRefusals } from "@/actions/gate-refusals.actions";
import { presenceRead } from "@/lib/presence/read-route";

/** GET /api/presence/gate-alerts?input={siteId}. The gate alert check, checked by getOnSiteGateRefusals (see read-route.ts). Dismissing stays an action. */
export const dynamic = "force-dynamic";
export const GET = presenceRead(getOnSiteGateRefusals);
