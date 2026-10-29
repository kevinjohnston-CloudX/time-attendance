// The app's styles, loaded by each layout (and the error and not found screens).
import "@/app/globals.css";
import { PageScrollReveal } from "@/components/layout/page-scroll-reveal";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { PhoneNav, PhoneTopBar } from "@/components/layout/phone-shell";
import { SheetGestures } from "@/components/layout/sheet-gestures";
import { CommandPalette, type Destination } from "@/components/layout/command-palette";
import { SECTIONS, ADMIN_GROUPS, INACTIVE_ALLOWED_HREFS } from "@/components/layout/nav-model";
import { InactiveRouteGuard } from "@/components/layout/inactive-route-guard";
import { INACTIVE_PATHS } from "@/lib/rbac/identity";
import { validViewAsId } from "@/lib/rbac/check-permission";
import { EmployeesListForget } from "@/components/admin/employees-list-forget";
import { exitTenant } from "@/actions/super-admin.actions";
import { LIVE_ATTENDANCE_HREF, LIVE_ATTENDANCE_ONLY_HREFS, REQUEST_PATH_HEADER, SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";
import { getPermissions } from "@/lib/rbac/permissions";
import { LEGACY_MAP } from "@/lib/rbac/legacy-map";
import { getLegacyPermissions, isLiveAttendanceOnly } from "@/lib/rbac/permission-resolver";
import { getWaitingOnYou } from "@/lib/dashboard/dashboard-data";
import { photoUrls } from "@/lib/presence/photos";

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
  // The same read also carries what the tablet photo lookup needs, so the
  // sidebar can show the signed-in person's own photo. Only ever their own.
  let tenantBannerName: string | null = null;
  const realRole = session.user.role ?? "EMPLOYEE";
  let sidebarRole = realRole;

  const customRoleId = session.user.customRoleId ?? null;
  const isPrivileged = PRIVILEGED_ROLES.includes(realRole);

  // Asked now, read below in the same order as ever, so it overlaps the
  // employee read instead of waiting behind it. A failure still surfaces at
  // the await; the no-op catch only keeps an early redirect from leaving it
  // unhandled.
  const liveAttendanceOnlyRead = isPrivileged ? Promise.resolve(false) : isLiveAttendanceOnly(customRoleId);
  liveAttendanceOnlyRead.catch(() => {});
  // The account shows a role of the company's own by its name: an agency
  // viewer read "Employee", the built-in role its custom role sits on.
  const ownRoleRead = customRoleId
    ? db.customRole.findUnique({ where: { id: customRoleId }, select: { name: true, isSystem: true } }).catch(() => null)
    : Promise.resolve(null);

  let isEmployeeActive = true;
  // Started here and awaited only when the shell is drawn, so the photo lookup
  // runs alongside the reads below instead of in front of them.
  let userPhotoRead: Promise<string | null> = Promise.resolve(null);
  if (session.user.employeeId) {
    const emp = await db.employee.findUnique({
      where: { id: session.user.employeeId },
      select: { id: true, isActive: true, tenantId: true, barcode: true, wmsId: true, employeeCode: true },
    });
    isEmployeeActive = emp?.isActive ?? true;
    if (emp) {
      userPhotoRead = photoUrls(emp.tenantId, [emp])
        .then((urls) => urls.get(emp.id) ?? null)
        .catch(() => null); // a failed lookup shows the initials, never breaks the page
    }
  }

  /**
   * A role limited to Live Attendance opens that page and nothing else. This
   * is the server holding the line for every portal page, the ones that check
   * no permission of their own included (Dashboard, Punch Clock, My Timesheet
   * and the rest of Me). The permission resolver refuses everything else
   * behind them too, so a server action called directly fails the same way.
   * Read from the role on every request, not the sign in token, so switching
   * the limit on reaches people already signed in within the resolver's
   * cache window.
   */
  // An inactive employee keeps three pages. The menu shows only those and
  // the browser guard below sends them back, but a typed address used to get
  // through: the server decides here.
  if (!isEmployeeActive) {
    const path = (await headers()).get(REQUEST_PATH_HEADER) ?? "";
    if (!INACTIVE_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) redirect("/time/timesheet");
  }

  const liveAttendanceOnly = await liveAttendanceOnlyRead;
  if (liveAttendanceOnly) {
    const path = (await headers()).get(REQUEST_PATH_HEADER) ?? "";
    const onPage = LIVE_ATTENDANCE_ONLY_HREFS.some((h) => path === h || path.startsWith(`${h}/`));
    if (!onPage) redirect(LIVE_ATTENDANCE_HREF);
  }

  const userCanViewAs = !liveAttendanceOnly && (session.user.canViewAs ?? false);
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
    // The same check every server action makes: a cookie naming a role that
    // is not junior to them, or not their company's, is ignored here too.
    const cookieVal = await validViewAsId(session.user);
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
  const can = (permission?: string | string[], href?: string) => {
    if (liveAttendanceOnly) return !!href && LIVE_ATTENDANCE_ONLY_HREFS.includes(href);
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
  const waiting = isEmployeeActive && !liveAttendanceOnly
    ? await getWaitingOnYou({
        employeeId: session.user.employeeId ?? null,
        tenantId: session.user.tenantId ?? null,
        canApproveTeam: userPermissions.includes("TIMESHEET_APPROVE_TEAM"),
        isPayroll: userPermissions.includes("PAY_PERIOD_MANAGE"),
        canApproveHr: userPermissions.includes("LEAVE_APPROVE_ANY"),
      })
    : [];

  // The phone's Approvals tab counts decisions only, not your own unsent requests.
  const approvalsCount = waiting.filter((i) => i.href !== "/leave").reduce((n, i) => n + i.count, 0);

  const userPhoto = await userPhotoRead;
  const ownRole = await ownRoleRead;
  const roleShown = ownRole && !ownRole.isSystem ? ownRole.name : realRole;

  const destinations: Destination[] = isEmployeeActive
    ? [
        ...SECTIONS.flatMap((s) =>
          s.items.filter((i) => can(i.permission, i.href)).map((i) => ({ label: i.label, href: i.href, group: s.label })),
        ),
        ...ADMIN_GROUPS.flatMap((g) =>
          g.items
            .filter((i) => can(i.permission, i.href))
            .map((i) => ({ label: i.label, href: i.href, group: g.label, detail: i.detail })),
        ),
      ]
    : SECTIONS.flatMap((s) =>
        s.items
          .filter((i) => INACTIVE_ALLOWED_HREFS.includes(i.href))
          .map((i) => ({ label: i.label, href: i.href, group: s.label })),
      );

  return (
    // h-dvh, not h-screen: on a phone 100vh reaches under Safari's toolbar,
    // which would hide the bottom bar behind it.
    <div className="ta-canvas flex h-dvh flex-col overflow-hidden">
      {/* The Layout handoff's super admin bar: a warning strip on the canvas,
          above the shell, with the way back to the super admin console. */}
      {tenantBannerName && (
        <div
          className="mx-2.5 mt-2.5 flex h-9 flex-none items-center gap-2.5 rounded-xl pl-3.5 pr-1.5"
          style={{
            background: "var(--surface-warning)",
            boxShadow: "inset 0 0 0 1px var(--stroke-warning)",
            font: "var(--type-body2)",
            color: "var(--text-warning)",
          }}
        >
          <ShieldCheck className="h-4 w-4 flex-none" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Super Admin, viewing <b style={{ fontWeight: "var(--weight-semibold)" }}>{tenantBannerName}</b>
          </span>
          <span className="flex-1" />
          <form
            action={async () => {
              "use server";
              await exitTenant();
            }}
          >
            <button
              type="submit"
              className="ta-warn-exit inline-flex h-[26px] flex-none items-center whitespace-nowrap rounded-lg px-2.5"
              style={{
                background: "var(--surface-card)",
                boxShadow: "var(--shadow-xs)",
                font: "var(--type-button2)",
                color: "var(--text-warning)",
              }}
            >
              Exit to Super Admin
            </button>
          </form>
        </div>
      )}
      {/* The Layout handoff's canvas: the sidebar floats as a card 12px in
          from every edge, and the content column sits beside it. Clipped,
          not hidden: a hidden box can still be scrolled sideways by focus,
          which pushed the sidebar off the left edge on a narrow window. */}
      <div className="ta-shell-row flex min-h-0 flex-1 gap-3 overflow-clip p-3">
        <div className="ta-desktop-only">
        <Sidebar
          role={sidebarRole}
          userName={session.user.name}
          userPhoto={userPhoto}
          permissions={userPermissions}
          realRole={roleShown}
          viewAsRole={viewAsRole}
          canViewAs={canUseViewAs && isEmployeeActive}
          viewAsOptions={viewAsOptions.map((r) => ({ id: r.id, name: r.name }))}
          isInactive={!isEmployeeActive}
          onlyHrefs={liveAttendanceOnly ? LIVE_ATTENDANCE_ONLY_HREFS : undefined}
        />
        </div>
        {/* Breadcrumb bar sits inside the content column, not above the
            sidebar, so it only ever costs the content its own 40px. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
          {/* The palette's destinations are already filtered by this
              viewer's permissions and by whether they are active, so the
              shortcuts list is built from the same set rather than a second
              one that could disagree with it. */}
          <div className="ta-desktop-only">
            <TopBar
              reachableHrefs={destinations.map((d) => d.href)}
              waiting={waiting}
              helpOffered={!liveAttendanceOnly}
              userPhoto={userPhoto}
            />
          </div>
          {/* Phones: this bar instead of the one above. */}
          <PhoneTopBar waiting={waiting} helpOffered={!liveAttendanceOnly} userPhoto={userPhoto} />
          <main className="ta-page-scroll min-h-0 flex-1 overflow-y-auto">
            <PageScrollReveal />
            <InactiveRouteGuard isInactive={!isEmployeeActive} />
            <EmployeesListForget />
            {/* The page's padding, from the Layout handoff. Pinned headers
                read the same two numbers (.ta-pin), so they sit where they pin. */}
            <div style={{ padding: "var(--ta-page-top) var(--ta-page-x) 16px" }}>{children}</div>
          </main>
        </div>
      </div>

      {/* Phones: a sheet can be dragged down to close it. */}
      <SheetGestures />
      {/* Phones: the bottom bar and Menu, in place of the sidebar. Fed the
          same permissions, so a phone reaches exactly what a computer does. */}
      <PhoneNav
        userName={session.user.name}
        userPhoto={userPhoto}
        permissions={userPermissions}
        realRole={roleShown}
        viewAsRole={viewAsRole}
        canViewAs={canUseViewAs && isEmployeeActive}
        viewAsOptions={viewAsOptions.map((r) => ({ id: r.id, name: r.name }))}
        isInactive={!isEmployeeActive}
        liveAttendanceOnly={liveAttendanceOnly}
        approvalsCount={approvalsCount}
      />

      <CommandPalette destinations={destinations} />
    </div>
  );
}
