import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/layout/sidebar";
import { exitTenant } from "@/actions/super-admin.actions";
import { SUPER_ADMIN_TENANT_COOKIE, VIEW_AS_ROLE_COOKIE } from "@/lib/constants";
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
  const realRole = session.user.role ?? "EMPLOYEE";
  let sidebarRole = realRole;

  // Build permission list for sidebar filtering — always driven by the enum role
  let userPermissions: string[] = [];
  if (realRole === "SUPER_ADMIN") {
    userPermissions = Object.keys(LEGACY_MAP);
  } else {
    userPermissions = getPermissions(sidebarRole as Parameters<typeof getPermissions>[0]);
  }

  if (realRole === "SUPER_ADMIN") {
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

  // View-as role override (SYSTEM_ADMIN and SUPER_ADMIN only)
  let viewAsRole: string | null = null;
  if (["SYSTEM_ADMIN", "SUPER_ADMIN"].includes(realRole)) {
    const cookieStore = await cookies();
    const cookieVal = cookieStore.get(VIEW_AS_ROLE_COOKIE)?.value;
    if (cookieVal) {
      viewAsRole = cookieVal;
      sidebarRole = viewAsRole;
      userPermissions = getPermissions(viewAsRole as Parameters<typeof getPermissions>[0]);
    }
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
        <Sidebar role={sidebarRole} userName={session.user.name} permissions={userPermissions} realRole={realRole} viewAsRole={viewAsRole} />
        <main className="flex-1 overflow-y-auto">
          <div className="px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
