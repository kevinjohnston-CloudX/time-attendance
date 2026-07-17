"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useEffect, useLayoutEffect } from "react";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Clock,
  CalendarDays,
  FileText,
  Users,
  DollarSign,
  Settings,
  LogOut,
  ClipboardList,
  AlertCircle,
  RefreshCw,
  SlidersHorizontal,
  CalendarClock,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  History,
  Shield,
  Layers,
} from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  permission?: string | string[];
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Punch Clock", href: "/time/punch", icon: Clock },
  { label: "My Timesheets", href: "/time/timesheet", icon: ClipboardList },
  { label: "Punch History", href: "/time/history", icon: CalendarDays },
  { label: "My Leave", href: "/leave", icon: CalendarDays },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Payroll", href: "/payroll", icon: DollarSign, permission: "PAY_PERIOD_MANAGE" },
  { label: "Timecards", href: "/payroll/timecards", icon: ClipboardList, permission: "PAY_PERIOD_MANAGE" },
  { label: "Reports", href: "/reports", icon: FileText, permission: "REPORT_MANAGE" },
];

const supervisorItems: NavItem[] = [
  { label: "Team Overview", href: "/supervisor", icon: Users, permission: "PUNCH_VIEW_TEAM" },
  { label: "Timesheets", href: "/supervisor/timesheets", icon: ClipboardList, permission: "PUNCH_VIEW_TEAM" },
  { label: "Exceptions", href: "/supervisor/exceptions", icon: AlertCircle, permission: "PUNCH_VIEW_TEAM" },
  { label: "Leave Requests", href: "/supervisor/leave", icon: CalendarDays, permission: "PUNCH_VIEW_TEAM" },
  { label: "Team Punch History", href: "/supervisor/punch-history", icon: History, permission: "PUNCH_VIEW_TEAM" },
];

const adminItems: NavItem[] = [
  { label: "Employees", href: "/admin/employees", icon: Users, permission: "EMPLOYEE_MANAGE" },
  { label: "Roles", href: "/admin/roles", icon: Shield, permission: "ROLE_MANAGE" },
  { label: "Site Settings", href: "/admin/site-settings", icon: Layers, permission: ["SITE_MANAGE", "RULES_MANAGE", "PAY_PERIOD_MANAGE"] },
  { label: "PTO Policies", href: "/admin/pto-policies", icon: CalendarClock, permission: "RULES_MANAGE" },
  { label: "ADP Sync", href: "/admin/adp", icon: RefreshCw, permission: "EMPLOYEE_MANAGE" },
  { label: "Audit Log", href: "/admin/audit", icon: FileText, permission: "AUDIT_VIEW" },
  { label: "Company Settings", href: "/admin/settings", icon: SlidersHorizontal, permission: "PAY_PERIOD_MANAGE" },
];

interface SidebarProps {
  role: string;
  userName?: string | null;
  permissions?: string[];
}

export function Sidebar({ role, userName, permissions }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [showAdminPopup, setShowAdminPopup] = useState(false);
  const [showTeamPopup, setShowTeamPopup] = useState(false);
  const [popupTop, setPopupTop] = useState(0);
  const [teamPopupTop, setTeamPopupTop] = useState(0);
  const adminBtnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const teamBtnRef = useRef<HTMLButtonElement>(null);
  const teamPopupRef = useRef<HTMLDivElement>(null);

  // Popup left offset depends on sidebar width
  const popupLeft = collapsed ? 64 : 232;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        adminBtnRef.current && !adminBtnRef.current.contains(target) &&
        popupRef.current && !popupRef.current.contains(target)
      ) {
        setShowAdminPopup(false);
      }
      if (
        teamBtnRef.current && !teamBtnRef.current.contains(target) &&
        teamPopupRef.current && !teamPopupRef.current.contains(target)
      ) {
        setShowTeamPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setShowAdminPopup(false);
    setShowTeamPopup(false);
  }, [pathname]);

  // After each popup opens, measure it and pull it up if it overflows the viewport.
  // useLayoutEffect runs before paint so there is no visible flicker.
  useLayoutEffect(() => {
    if (!showAdminPopup || !popupRef.current) return;
    const bottom = popupRef.current.getBoundingClientRect().bottom;
    const overflow = bottom - (window.innerHeight - 8);
    if (overflow > 0) setPopupTop((t) => Math.max(8, t - overflow));
  }, [showAdminPopup]);

  useLayoutEffect(() => {
    if (!showTeamPopup || !teamPopupRef.current) return;
    const bottom = teamPopupRef.current.getBoundingClientRect().bottom;
    const overflow = bottom - (window.innerHeight - 8);
    if (overflow > 0) setTeamPopupTop((t) => Math.max(8, t - overflow));
  }, [showTeamPopup]);

  function hasPermission(perm?: string | string[]) {
    if (!perm) return true;
    if (!permissions || permissions.length === 0) return false;
    if (Array.isArray(perm)) return perm.some((p) => permissions.includes(p));
    return permissions.includes(perm);
  }

  const visibleItems = navItems.filter((item) => hasPermission(item.permission));
  const visibleAdminItems = adminItems.filter((item) => hasPermission(item.permission));
  const visibleSupervisorItems = supervisorItems.filter((item) => hasPermission(item.permission));
  const isAdminActive = pathname.startsWith("/admin");
  const isTeamActive = pathname.startsWith("/supervisor");

  const linkClass = (isActive: boolean) =>
    `flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      collapsed ? "justify-center px-0" : "gap-3"
    } ${
      isActive
        ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
        : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
    }`;

  return (
    <aside
      className={`flex h-screen flex-col border-r border-zinc-200 bg-white transition-[width] duration-200 ease-in-out dark:border-zinc-800 dark:bg-zinc-900 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      {/* Logo */}
      <div
        className={`flex items-center border-b border-zinc-200 bg-zinc-400 dark:border-zinc-800 dark:bg-transparent ${
          collapsed ? "h-14 justify-center px-2" : "h-24 px-4"
        }`}
      >
        <img
          src="/cloudx-logo.png"
          alt="CloudX Systems"
          className={`object-contain transition-all duration-200 ${
            collapsed ? "h-8 w-8" : "w-full"
          }`}
        />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        <ul className="flex flex-col gap-0.5">
          {visibleItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" &&
                pathname.startsWith(item.href) &&
                !visibleItems.some(
                  (other) =>
                    other.href !== item.href &&
                    other.href.length > item.href.length &&
                    other.href.startsWith(item.href) &&
                    (pathname === other.href || pathname.startsWith(other.href))
                ));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={linkClass(isActive)}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && item.label}
                </Link>
              </li>
            );
          })}

          {/* My Team popup trigger */}
          {visibleSupervisorItems.length > 0 && (
            <li>
              <button
                ref={teamBtnRef}
                type="button"
                title={collapsed ? "My Team" : undefined}
                onClick={() => {
                  if (teamBtnRef.current) {
                    setTeamPopupTop(teamBtnRef.current.getBoundingClientRect().top);
                  }
                  setShowTeamPopup((v) => !v);
                }}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  collapsed ? "justify-center px-0" : "gap-3"
                } ${
                  isTeamActive || showTeamPopup
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                }`}
              >
                <Users className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">My Team</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  </>
                )}
              </button>

              {showTeamPopup && (
                <div
                  ref={teamPopupRef}
                  style={{ top: teamPopupTop, left: popupLeft }}
                  className="fixed z-50 w-52 rounded-xl border border-zinc-200 bg-white py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 max-h-[calc(100vh-1rem)] overflow-y-auto"
                >
                  <p className="px-3 pb-1.5 pt-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    My Team
                  </p>
                  {visibleSupervisorItems.map((item) => (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => {
                        setShowTeamPopup(false);
                        router.push(item.href);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                        pathname === item.href || (item.href !== "/supervisor" && pathname.startsWith(item.href))
                          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                          : "text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                      }`}
                    >
                      <item.icon className="h-4 w-4 shrink-0 text-zinc-400" />
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          )}

          {/* Admin popup trigger */}
          {visibleAdminItems.length > 0 && (
            <li>
              <button
                ref={adminBtnRef}
                type="button"
                title={collapsed ? "Admin" : undefined}
                onClick={() => {
                  if (adminBtnRef.current) {
                    setPopupTop(adminBtnRef.current.getBoundingClientRect().top);
                  }
                  setShowAdminPopup((v) => !v);
                }}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  collapsed ? "justify-center px-0" : "gap-3"
                } ${
                  isAdminActive || showAdminPopup
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                }`}
              >
                <Settings className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">Admin</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  </>
                )}
              </button>

              {showAdminPopup && (
                <div
                  ref={popupRef}
                  style={{ top: popupTop, left: popupLeft }}
                  className="fixed z-50 w-52 rounded-xl border border-zinc-200 bg-white py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 max-h-[calc(100vh-1rem)] overflow-y-auto"
                >
                  <p className="px-3 pb-1.5 pt-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    Admin
                  </p>
                  {visibleAdminItems.map((item) => (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => {
                        setShowAdminPopup(false);
                        router.push(item.href);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                        pathname.startsWith(item.href)
                          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                          : "text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                      }`}
                    >
                      <item.icon className="h-4 w-4 shrink-0 text-zinc-400" />
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          )}
        </ul>
      </nav>

      {/* User / Logout */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        {collapsed ? (
          /* Collapsed: icon-only column */
          <div className="flex flex-col items-center gap-1">
            <button
              title="Expand sidebar"
              onClick={() => setCollapsed(false)}
              className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
            <ThemeToggle iconOnly />
            <button
              title="Sign out"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          /* Expanded */
          <>
            <div className="flex items-center justify-between px-2 py-1">
              {userName && (
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {userName}
                </p>
              )}
              <button
                title="Collapse sidebar"
                onClick={() => setCollapsed(true)}
                className="ml-1 shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </div>
            <ThemeToggle />
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Sign Out
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
