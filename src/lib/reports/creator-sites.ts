import { db } from "@/lib/db";
import { siteLimit } from "@/lib/rbac/site-limit";
import type { ReportConfig } from "@/lib/validators/report.schema";

/**
 * A report shows the sites its creator may see, whoever runs it.
 *
 * <p>A Payroll Admin held to some sites makes reports of those sites only,
 * whatever filters they pick, and a copy they duplicate is theirs and held
 * the same way. A report by someone with no site limit (HR, a System Admin)
 * shows what they set, to anyone they share it with: that is their call.
 * Read at every run, so a change to someone's site access reaches their
 * saved and emailed reports at once.
 */
export async function creatorSites(ownerUserId: string): Promise<string[] | null> {
  const owner = await db.employee.findUnique({ where: { userId: ownerUserId }, select: { id: true, role: true } });
  if (!owner) return null;
  return siteLimit({ employeeId: owner.id, role: owner.role });
}

/** The report's own filters, and "site is one of" the creator's sites when they are held to some. */
export async function withCreatorSites(config: ReportConfig, ownerUserId: string): Promise<ReportConfig> {
  const sites = await creatorSites(ownerUserId);
  if (!sites) return config;
  return { ...config, filters: [...config.filters, { field: "siteId", operator: "in", value: sites }] };
}
