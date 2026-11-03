import { db } from "@/lib/db";

/**
 * Whether a company may use the platform's ADP connection or its WMS bridge.
 *
 * <p>There is one of each for the whole platform: ADP signs in with the ADP_*
 * server settings, and one bridge reads one Oracle. Any company could use
 * them, so the demo company was sent Main Office's Oracle roster every five
 * minutes, and its admins could have pulled Main Office's ADP workforce or
 * pushed hours into its payroll (security audit 2026-11, H2). Only a company
 * marked as theirs may, and a new company starts unmarked.
 */
export type Integration = "adp" | "wms";

const NAME: Record<Integration, string> = { adp: "ADP", wms: "WMS" };

export async function integrationConnected(tenantId: string | null | undefined, which: Integration): Promise<boolean> {
  if (!tenantId) return false;
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { adpConnected: true, wmsConnected: true } });
  return !!t && (which === "adp" ? t.adpConnected : t.wmsConnected);
}

export class NotConnectedError extends Error {
  constructor(which: Integration) {
    super(`${NAME[which]} isn't connected for this company.`);
    this.name = "NotConnectedError";
  }
}

export async function assertIntegrationConnected(tenantId: string | null | undefined, which: Integration): Promise<void> {
  if (!(await integrationConnected(tenantId, which))) throw new NotConnectedError(which);
}
