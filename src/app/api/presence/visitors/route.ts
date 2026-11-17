import { getOnSiteVisitors } from "@/actions/visitor-day.actions";
import { presenceRead } from "@/lib/presence/read-route";

/** GET /api/presence/visitors?input={siteId,day}. A building's visitors for the day, checked by getOnSiteVisitors (see read-route.ts). */
export const dynamic = "force-dynamic";
export const GET = presenceRead(getOnSiteVisitors);
