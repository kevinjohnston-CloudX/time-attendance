import { redirect } from "next/navigation";

/**
 * Team Leave moved to Approvals (11/11), its first queue beside timecard
 * edits. Links and bookmarks to here still land on it, filters and tab kept.
 */
export default async function SupervisorLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; siteId?: string; departmentId?: string; shiftId?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const params = new URLSearchParams({ view: "leave" });
  for (const k of ["tab", "siteId", "departmentId", "shiftId"] as const) if (sp[k]) params.set(k, sp[k]!);
  redirect(`/approvals?${params.toString()}`);
}
