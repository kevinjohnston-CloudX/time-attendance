import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { CommandPalette, type Destination } from "@/components/layout/command-palette";
import { SECTIONS, ADMIN_GROUPS, INACTIVE_ALLOWED_HREFS } from "@/components/layout/nav-model";
import { InactiveRouteGuard } from "@/components/layout/inactive-route-guard";
import { exitTenant } from "@/actions/super-admin.actions";
import { SUPER_ADMIN_TENANT_COOKIE, VIEW_AS_ROLE_COOKIE } from "@/lib/constants";
import { getPermissions } from "@/lib/rbac/permissions";
import { LEGACY_MAP } from "@/lib/rbac/legacy-map";
import { getLegacyPermissions } from "@/lib/rbac/permission-resolver";
import { getWaitingOnYou } from "@/lib/dashboard/dashboard-data";

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

  /**
   * What ⌘K can reach.
   *
   * <p>Built here rather than in the palette so the filtering happens on the
   * server: the browser is only ever handed pages this person can already
   * open from the nav. An inactive employee gets the same restricted set the
   * sidebar shows them.
   *
   * <p>Uses `userPermissions`, the same list the sidebar is given, which is
   * resolved from a custom role where one exists. Worth knowing: the
   * Administration hub filters with `hasPermission(effectiveRole, …)` instead,
   * which reads the built-in role only — so for a user on a custom role the
   * two can disagree about which admin pages to list. That is pre-existing and
   * I have not changed it; the destination pages enforce their own access
   * either way.
   */
  const can = (permission?: string | string[]) => {
    if (!permission) return true;
    if (Array.isArray(permission)) return permission.some((p) => userPermissions.includes(p));
    return userPermissions.includes(permission);
  };

  /**
   * What the bell counts. Read here rather than in the bell because the
   * layout already knows this viewer's permissions, so it costs no extra
   * permission lookup — only the counts themselves, which are indexed.
   *
   * <p>An inactive employee is shown nothing: every queue behind these counts
   * is a page their route guard already refuses.
   */
  const waiting = isEmployeeActive
    ? await getWaitingOnYou({
        employeeId: session.user.employeeId ?? null,
        tenantId: session.user.tenantId ?? null,
        canApproveTeam: userPermissions.includes("TIMESHEET_APPROVE_TEAM"),
        isPayroll: userPermissions.includes("PAY_PERIOD_MANAGE"),
      })
    : [];

  const destinations: Destination[] = isEmployeeActive
    ? [
        ...SECTIONS.flatMap((s) =>
          s.items.filter((i) => can(i.permission)).map((i) => ({ label: i.label, href: i.href, group: s.label })),
        ),
        ...ADMIN_GROUPS.flatMap((g) =>
          g.items
            .filter((i) => can(i.permission))
            .map((i) => ({ label: i.label, href: i.href, group: g.label, detail: i.detail })),
        ),
      ]
    : SECTIONS.flatMap((s) =>
        s.items
          .filter((i) => INACTIVE_ALLOWED_HREFS.includes(i.href))
          .map((i) => ({ label: i.label, href: i.href, group: s.label })),
      );

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: "var(--surface-page)" }}
    >
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
        {/* Breadcrumb bar sits inside the content column, not above the
            sidebar, so it only ever costs the content its own 40px. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The palette's destinations are already filtered by this
              viewer's permissions and by whether they are active, so the
              shortcuts list is built from the same set rather than a second
              one that could disagree with it. */}
          <TopBar reachableHrefs={destinations.map((d) => d.href)} waiting={waiting} />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <InactiveRouteGuard isInactive={!isEmployeeActive} />
            {/* --space-content: the design moved main padding from 24px to
                16px so tables get the width back. */}
            <div className="px-4 pb-6 pt-4">{children}</div>
          </main>
        </div>
      </div>

      <CommandPalette destinations={destinations} />
    </div>
  );
}
