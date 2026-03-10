import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/layout/sidebar";
import { exitTenant } from "@/actions/super-admin.actions";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";
import { getAllPermissions } from "@/lib/rbac/permission-resolver";
import { getPermissions } from "@/lib/rbac/permissions";
import { LEGACY_MAP } from "@/lib/rbac/legacy-map";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  let tenantBannerName: string | null = null;
  let sidebarRole = session.user.role ?? "EMPLOYEE";

  // Build permission list for sidebar filtering
  let userPermissions: string[] = [];
  if (session.user.role === "SUPER_ADMIN") {
    // SUPER_ADMIN gets all permissions
    userPermissions = Object.keys(LEGACY_MAP);
  } else if (session.user.customRoleId) {
    // DB-backed custom role
    const perms = await getAllPermissions(session.user.customRoleId);
    // Convert permission tuples to legacy permission strings for sidebar
    const legacyPerms = new Set<string>();
    for (const [key, tuple] of Object.entries(LEGACY_MAP)) {
      const match = perms.some(
        (p) =>
          p.resource === tuple.resource &&
          p.action === tuple.action &&
          (p.scope === tuple.scope || p.scope === "all" || (p.scope === "team" && tuple.scope === "own"))
      );
      if (match) legacyPerms.add(key);
    }
    userPermissions = Array.from(legacyPerms);
  } else {
    // Fallback to legacy enum role
    userPermissions = getPermissions(sidebarRole as Parameters<typeof getPermissions>[0]);
  }

  if (session.user.role === "SUPER_ADMIN") {
    const cookieStore = await cookies();
    const tenantOverride = cookieStore.get(SUPER_ADMIN_TENANT_COOKIE)?.value;
    if (!tenantOverride) redirect("/super-admin");

    const tenant = await db.tenant.findUnique({
      where: { id: tenantOverride },
      select: { name: true },
    });
    if (!tenant) redirect("/super-admin");

    tenantBannerName = tenant.name;
    sidebarRole = "SYSTEM_ADMIN";
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      {tenantBannerName && (
        <div className="flex shrink-0 items-center justify-between bg-amber-400 px-4 py-2 text-sm font-medium text-amber-950">
          <span>Super Admin — viewing as: <strong>{tenantBannerName}</strong></span>
          <form
            action={async () => {
              "use server";
              await exitTenant();
            }}
          >
            <button
              type="submit"
              className="rounded bg-amber-950/20 px-3 py-1 text-xs hover:bg-amber-950/30"
            >
              ← Exit to Super Admin
            </button>
          </form>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar role={sidebarRole} userName={session.user.name} permissions={userPermissions} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
