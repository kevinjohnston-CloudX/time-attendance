"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: string[];
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Punch Clock", href: "/time/punch", icon: Clock },
  { label: "My Timesheets", href: "/time/timesheet", icon: ClipboardList },
  { label: "Punch History", href: "/time/history", icon: CalendarDays },
  { label: "My Leave", href: "/leave", icon: CalendarDays },
  { label: "Documents", href: "/documents", icon: FileText },
  // Supervisor+
  {
    label: "My Team",
    href: "/supervisor",
    icon: Users,
    roles: ["SUPERVISOR", "PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"],
  },
  {
    label: "Exceptions",
    href: "/supervisor/exceptions",
    icon: AlertCircle,
    roles: ["SUPERVISOR", "PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"],
  },
  // Payroll+
  {
    label: "Payroll",
    href: "/payroll",
    icon: DollarSign,
    roles: ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"],
  },
  {
    label: "Timecards",
    href: "/payroll/timecards",
    icon: ClipboardList,
    roles: ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"],
  },
  // Payroll+ reports
  {
    label: "Reports",
    href: "/reports",
    icon: FileText,
    roles: ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"],
  },
  // Admin+
  {
    label: "Admin",
    href: "/admin",
    icon: Settings,
    roles: ["HR_ADMIN", "SYSTEM_ADMIN"],
  },
];

interface SidebarProps {
  role: string;
  userName?: string | null;
}

export function Sidebar({ role, userName }: SidebarProps) {
  const pathname = usePathname();

  const visibleItems = navItems.filter(
    (item) => !item.roles || item.roles.includes(role)
  );

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-zinc-200 px-4 dark:border-zinc-800">
        <span className="text-sm font-bold text-zinc-900 dark:text-white">
          Time &amp; Attendance
        </span>
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
                    (pathname === other.href ||
                      pathname.startsWith(other.href))
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
        </ul>
      </nav>

      {/* User / Logout */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        {userName && (
          <p className="truncate px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">
            {userName}
          </p>
        )}
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
