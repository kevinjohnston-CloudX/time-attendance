import type {
  getOnSiteBoard as boardAction,
  getOnSiteMovements as movementsAction,
  getOnSiteScanLog as scanLogAction,
} from "@/actions/presence.actions";
import type { getOnSiteGateRefusals as gateAlertsAction } from "@/actions/gate-refusals.actions";
import type { getSiteTablets as tabletsAction } from "@/actions/tablets.actions";
import type { getOnSiteUnknownBadges as unknownBadgesAction } from "@/actions/unknown-badges.actions";

/**
 * Live Attendance's reads, asked through its GET routes instead of as server
 * actions (see read-route.ts for why). Each takes the same question and
 * answers the same `{ success, data }` or `{ success: false, error }` as the
 * action of the same name, so a caller swaps the import and nothing else.
 *
 * <p>Like an action, a call that never gets an answer (offline, the server
 * restarting) throws, and every caller already treats that as a failed try.
 */

type Read<A extends (input: never) => Promise<unknown>> = (input: Parameters<A>[0]) => ReturnType<A>;

function read<A extends (input: never) => Promise<unknown>>(path: string): Read<A> {
  return (async (input: unknown) => {
    const res = await fetch(`/api/presence/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, {
      cache: "no-store",
    });
    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== "object" || typeof (body as { success?: unknown }).success !== "boolean") {
      throw new Error(`HTTP ${res.status}`);
    }
    return body;
  }) as Read<A>;
}

export const getOnSiteBoard = read<typeof boardAction>("board");
export const getOnSiteScanLog = read<typeof scanLogAction>("scan-log");
export const getOnSiteMovements = read<typeof movementsAction>("movements");
export const getOnSiteGateRefusals = read<typeof gateAlertsAction>("gate-alerts");
export const getSiteTablets = read<typeof tabletsAction>("tablets");
export const getOnSiteUnknownBadges = read<typeof unknownBadgesAction>("unknown-badges");
