"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useEffect } from "react";
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
  Building2,
  FolderOpen,
  Calendar,
  RefreshCw,
  SlidersHorizontal,
  CalendarClock,
  ChevronRight,
  History,
  Shield,
} from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  permission?: string;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Punch Clock", href: "/time/punch", icon: Clock },
  { label: "My Timesheets", href: "/time/timesheet", icon: ClipboardList },
  { label: "Punch History", href: "/time/history", icon: CalendarDays },
  { label: "My Leave", href: "/leave", icon: CalendarDays },
  { label: "Documents", href: "/documents", icon: FileText },
  // Payroll+
  { label: "Payroll", href: "/payroll", icon: DollarSign, permission: "PAY_PERIOD_MANAGE" },
  { label: "Timecards", href: "/payroll/timecards", icon: ClipboardList, permission: "PAY_PERIOD_MANAGE" },
  // Reports
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
  { label: "Sites", href: "/admin/sites", icon: Building2, permission: "SITE_MANAGE" },
  { label: "Departments", href: "/admin/departments", icon: FolderOpen, permission: "SITE_MANAGE" },
  { label: "Leave Types", href: "/admin/leave-types", icon: Calendar, permission: "RULES_MANAGE" },
  { label: "PTO Policies", href: "/admin/pto-policies", icon: CalendarClock, permission: "RULES_MANAGE" },
  { label: "Rule Sets", href: "/admin/rules", icon: Settings, permission: "RULES_MANAGE" },
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
  const [showAdminPopup, setShowAdminPopup] = useState(false);
  const [showTeamPopup, setShowTeamPopup] = useState(false);
  const [popupTop, setPopupTop] = useState(0);
  const [teamPopupTop, setTeamPopupTop] = useState(0);
  const adminBtnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const teamBtnRef = useRef<HTMLButtonElement>(null);
  const teamPopupRef = useRef<HTMLDivElement>(null);

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

  // Close popups on route change
  useEffect(() => {
    setShowAdminPopup(false);
    setShowTeamPopup(false);
  }, [pathname]);

  function hasPermission(perm?: string) {
    if (!perm) return true;
    if (permissions && permissions.length > 0) return permissions.includes(perm);
    return false;
  }

  const visibleItems = navItems.filter((item) => hasPermission(item.permission));
  const visibleAdminItems = adminItems.filter((item) => hasPermission(item.permission));
  const visibleSupervisorItems = supervisorItems.filter((item) => hasPermission(item.permission));
  const isAdminActive = pathname.startsWith("/admin");
  const isTeamActive = pathname.startsWith("/supervisor");

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Logo */}
      <div className="flex h-24 items-center border-b border-zinc-200 bg-zinc-400 px-4 dark:border-zinc-800 dark:bg-transparent">
        <img src="/cloudx-logo.png" alt="CloudX Systems" className="w-full object-contain" />
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
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                      : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
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
                onClick={() => {
                  if (teamBtnRef.current) {
                    setTeamPopupTop(teamBtnRef.current.getBoundingClientRect().top);
                  }
                  setShowTeamPopup((v) => !v);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isTeamActive || showTeamPopup
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                }`}
              >
                <Users className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">My Team</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              </button>

              {showTeamPopup && (
                <div
                  ref={teamPopupRef}
                  style={{ top: teamPopupTop, left: 232 }}
                  className="fixed z-50 w-52 rounded-xl border border-zinc-200 bg-white py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
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
                onClick={() => {
                  if (adminBtnRef.current) {
                    setPopupTop(adminBtnRef.current.getBoundingClientRect().top);
                  }
                  setShowAdminPopup((v) => !v);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isAdminActive || showAdminPopup
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                }`}
              >
                <Settings className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">Admin</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              </button>

              {showAdminPopup && (
                <div
                  ref={popupRef}
                  style={{ top: popupTop, left: 232 }}
                  className="fixed z-50 w-52 rounded-xl border border-zinc-200 bg-white py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
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
        {userName && (
          <p className="truncate px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">
            {userName}
          </p>
        )}
        <ThemeToggle />
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
