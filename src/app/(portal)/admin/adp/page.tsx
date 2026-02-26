import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getAdpSyncStatus } from "@/actions/adp.actions";
import { getAdminRefData } from "@/actions/admin.actions";
import { AdpSyncPanel } from "@/components/admin/adp-sync-panel";

export default async function AdpSyncPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "EMPLOYEE_MANAGE")) redirect("/admin");

  const [statusResult, refResult] = await Promise.all([
    getAdpSyncStatus(undefined as never),
    getAdminRefData(),
  ]);

  if (!statusResult.success || !refResult.success) redirect("/admin");

  const { sites, departments, ruleSets } = refResult.data;

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Admin
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
        ADP Sync
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Sync employee data from ADP Workforce Now into this system.
      </p>

      <div className="mt-6">
        <AdpSyncPanel
          status={statusResult.data}
          sites={sites}
          departments={departments}
          ruleSets={ruleSets}
        />
      </div>
    </div>
  );
}
