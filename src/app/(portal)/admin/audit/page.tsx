import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAuditActors, getAuditLogs, type AuditRange } from "@/actions/admin.actions";
import { Banner, PageHeader } from "@/components/ui";
import { AuditLog } from "@/components/admin/audit-log";

/**
 * The Audit Log. Payroll, HR and system admins (AUDIT_VIEW) read the whole
 * company's log; the screen is AuditLog, and this only gates it and loads
 * the page of entries the query string asks for.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; entityType?: string; q?: string; actor?: string; range?: string; tz?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "AUDIT_VIEW")) redirect("/admin");

  const filters = {
    q: sp.q ?? "",
    type: sp.entityType ?? "",
    actor: sp.actor ?? "",
    range: ["today", "7", "30"].includes(sp.range ?? "") ? (sp.range as string) : "any",
  };

  const [result, actors] = await Promise.all([
    getAuditLogs({
      page: Number(sp.page ?? 1),
      entityType: filters.type || undefined,
      q: filters.q || undefined,
      actor: filters.actor || undefined,
      range: filters.range as AuditRange,
      tz: sp.tz,
    }),
    getAuditActors(),
  ]);

  if (!result.success) {
    return (
      <div className="flex flex-col gap-3.5">
        <PageHeader pinned title="Audit Log" />
        <Banner tone="error" title="The audit log could not be loaded" body={result.error} />
      </div>
    );
  }

  return (
    <AuditLog
      logs={result.data.logs}
      total={result.data.total}
      page={result.data.page}
      pages={result.data.pages}
      actors={actors.success ? actors.data : []}
      filters={filters}
    />
  );
}
