import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAdpSyncOptions, getAdpSyncStatus } from "@/actions/adp.actions";
import { AdpSyncPanel } from "@/components/admin/adp-sync-panel";

/**
 * ADP Sync, on the portal design's doc template.
 *
 * <p>The page header is rendered by {@link AdpSyncPanel} rather than here. The
 * design makes "Sync Now" a page action, and a sync runs with the three mapping
 * defaults chosen further down the page — a header on this side would have to
 * reach into that component's state to know what to send, so the header goes
 * where the state already is.
 */
export default async function AdpSyncPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "EMPLOYEE_MANAGE")) redirect("/admin");

  const [statusResult, refResult] = await Promise.all([
    getAdpSyncStatus(undefined as never),
    getAdpSyncOptions(undefined as never),
  ]);

  if (!statusResult.success || !refResult.success) redirect("/admin");

  const { sites, departments, ruleSets } = refResult.data;

  return (
    <div className="flex flex-col gap-4">
      <AdpSyncPanel
        status={statusResult.data}
        sites={sites}
        departments={departments}
        ruleSets={ruleSets}
      />
    </div>
  );
}
