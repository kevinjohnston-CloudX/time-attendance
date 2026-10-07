import { getOnSiteScanLog } from "@/actions/presence.actions";
import { presenceRead } from "@/lib/presence/read-route";

/** GET /api/presence/scan-log?input={siteId,...}. The scan log and its export, checked by getOnSiteScanLog (see read-route.ts). */
export const dynamic = "force-dynamic";
export const GET = presenceRead(getOnSiteScanLog);
