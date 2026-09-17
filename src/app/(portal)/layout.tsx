import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/layout/sidebar";
import { InactiveRouteGuard } from "@/components/layout/inactive-route-guard";
import { exitTenant } from "@/actions/super-admin.actions";
import { SUPER_ADMIN_TENANT_COOKIE, VIEW_AS_ROLE_COOKIE } from "@/lib/constants";
import { getPermissions } from "@/lib/rbac/permissions";
import { LEGACY_MAP } from "@/lib/rbac/legacy-map";
import { getLegacyPermissions } from "@/lib/rbac/permission-resolver";

const PRIVILEGED_ROLES = ["SYSTEM_ADMIN", "SUPER_ADMIN"];

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");

  // Check if the employee is active. Inactive employees get a restricted read-only view.
  let isEmployeeActive = true;
  if (session.user.employeeId) {
    const emp = await db.employee.findUnique({
      where: { id: session.user.employeeId },
      select: { isActive: true },
    });
    isEmployeeActive = emp?.isActive ?? true;
  }

  let tenantBannerName: string | null = null;
  const realRole = session.user.role ?? "EMPLOYEE";
  let sidebarRole = realRole;

  const customRoleId = session.user.customRoleId ?? null;
  const userCanViewAs = session.user.canViewAs ?? false;
  const isPrivileged = PRIVILEGED_ROLES.includes(realRole);
  const canUseViewAs = isPrivileged || userCanViewAs;

  // Build sidebar permissions for the user's real role
  let userPermissions: string[] = [];
  if (realRole === "SUPER_ADMIN" || realRole === "SYSTEM_ADMIN") {
    userPermissions = Object.keys(LEGACY_MAP);
  } else if (customRoleId) {
    userPermissions = await getLegacyPermissions(customRoleId);
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

  // Determine user's rank for filtering view-as options
  let userRank: number | null = null;
  if (!isPrivileged && canUseViewAs && customRoleId) {
    const cr = await db.customRole.findUnique({ where: { id: customRoleId }, select: { rank: true } });
    userRank = cr?.rank ?? 0;
  }

  // Fetch available view-as roles (lower rank than user, or all for privileged)
  const effectiveTenantId = session.user.tenantId ?? null;
  let viewAsOptions: { id: string; name: string; rank: number }[] = [];
  if (canUseViewAs && effectiveTenantId) {
    const cookieStore = await cookies();
    const tenantOverride = cookieStore.get(SUPER_ADMIN_TENANT_COOKIE)?.value;
    const lookupTenantId = tenantOverride ?? effectiveTenantId;

    viewAsOptions = await db.customRole.findMany({
      where: {
        tenantId: lookupTenantId,
        isActive: true,
        ...(userRank !== null ? { rank: { lt: userRank } } : {}),
      },
      select: { id: true, name: true, rank: true },
      orderBy: { rank: "desc" },
    });
  }

  // View-as role override — reads cookie and uses real DB permissions
  let viewAsRole: string | null = null;
  if (canUseViewAs) {
    const cookieStore = await cookies();
    const cookieVal = cookieStore.get(VIEW_AS_ROLE_COOKIE)?.value;
    if (cookieVal) {
      // Look up the role name and permissions from DB
      const viewAsRoleData = viewAsOptions.find((r) => r.id === cookieVal)
        ?? await db.customRole.findUnique({ where: { id: cookieVal }, select: { id: true, name: true, rank: true } })
            .then((r) => r ?? null);

      if (viewAsRoleData) {
        viewAsRole = viewAsRoleData.name;
        sidebarRole = viewAsRole;
        userPermissions = await getLegacyPermissions(cookieVal);
      }
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
        <Sidebar
          role={sidebarRole}
          userName={session.user.name}
          permissions={userPermissions}
          realRole={realRole}
          viewAsRole={viewAsRole}
          canViewAs={canUseViewAs && isEmployeeActive}
          viewAsOptions={viewAsOptions.map((r) => ({ id: r.id, name: r.name }))}
          isInactive={!isEmployeeActive}
        />
        <main className="flex-1 overflow-y-auto">
          <InactiveRouteGuard isInactive={!isEmployeeActive} />
          <div className="px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
