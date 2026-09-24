import {
  LayoutDashboard,
  Clock,
  ClipboardList,
  History,
  CalendarDays,
  FileText,
  Hourglass,
  Users,
  ClipboardCheck,
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  FileSpreadsheet,
  BarChart3,
  IdCard,
  Layers,
  BookOpen,
  ShieldCheck,
  RefreshCw,
  KeyRound,
  ScrollText,
  SlidersHorizontal,
  CircleUser,
  Banknote,
  Cog,
  DoorOpen,
} from "lucide-react";

/**
 * One description of the navigation, read by both the sidebar and the
 * breadcrumb.
 *
 * <p>Kept in its own module on purpose: a breadcrumb that derives its section
 * name from a second copy of this list is a breadcrumb that eventually
 * disagrees with the sidebar about where you are. Here there is nothing to
 * keep in step.
 */

export type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  permission?: string | string[];
  /**
   * Count pill, as the design draws on the Team items. Nothing sets it yet —
   * the numbers it wants (timesheets awaiting you, open exceptions, pending
   * leave) are three more queries on every page load, so the slot is here and
   * the wiring is a deliberate next step. An invented number would be worse
   * than no number: people act on these.
   */
  badge?: number;
};

export type NavSection = {
  id: string;
  label: string;
  /** The section's own hub page, when it has one, so the breadcrumb can link to it. */
  href?: string;
  /**
   * The rail draws one button per section, so a section needs an icon and a
   * label short enough to sit under it in 64px. "Administration" does not, so
   * the rail says "Admin" while every other surface keeps the full name.
   */
  icon: React.ElementType;
  railLabel: string;
  items: NavItem[];
  /**
   * Route prefixes that belong to this section but are not themselves nav
   * destinations — /admin/sites/[id], /reports/[id], a timesheet by id.
   *
   * <p>Without these the breadcrumb goes blank the moment you open a record,
   * which is exactly when knowing where you are matters most. The section is
   * still true even when the leaf has no menu entry.
   */
  prefixes: string[];
};

/**
 * Four groups, taken from the portal design's SECTIONS.
 *
 * <p>The old sidebar was one flat list with two flyout popups bolted on,
 * because the list had grown too long to read. Grouping is what removes the
 * need for those popups, so they are gone: every destination is now visible in
 * a single scroll, and nothing is two clicks deep any more.
 */
export const SECTIONS: NavSection[] = [
  {
    id: "me",
    icon: CircleUser,
    railLabel: "Me",
    label: "Me",
    prefixes: ["/dashboard", "/time", "/leave", "/documents", "/accruals"],
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Punch Clock", href: "/time/punch", icon: Clock },
      { label: "My Timesheet", href: "/time/timesheet", icon: ClipboardList },
      { label: "Punch History", href: "/time/history", icon: History },
      { label: "My Leave", href: "/leave", icon: CalendarDays },
      { label: "My Documents", href: "/documents", icon: FileText },
      {
        label: "Accruals",
        href: "/accruals",
        icon: Hourglass,
        permission: ["ACCRUAL_VIEW_OWN", "ACCRUAL_VIEW_TEAM", "ACCRUAL_VIEW_ANY"],
      },
    ],
  },
  {
    id: "team",
    icon: Users,
    railLabel: "Team",
    label: "Team",
    prefixes: ["/supervisor"],
    items: [
      { label: "Team Overview", href: "/supervisor", icon: Users, permission: "PUNCH_VIEW_TEAM" },
      { label: "Live Attendance", href: "/supervisor/on-site", icon: DoorOpen, permission: "PRESENCE_VIEW_ANY" },
      { label: "Timesheets", href: "/supervisor/timesheets", icon: ClipboardCheck, permission: "PUNCH_VIEW_TEAM" },
      { label: "Exceptions", href: "/supervisor/exceptions", icon: AlertTriangle, permission: "PUNCH_VIEW_TEAM" },
      { label: "Leave Requests", href: "/supervisor/leave", icon: CalendarClock, permission: "PUNCH_VIEW_TEAM" },
      { label: "Team Punch History", href: "/supervisor/punch-history", icon: History, permission: "PUNCH_VIEW_TEAM" },
    ],
  },
  {
    id: "payroll",
    icon: Banknote,
    railLabel: "Payroll",
    label: "Payroll",
    prefixes: ["/payroll", "/reports"],
    items: [
      { label: "Pay Periods", href: "/payroll", icon: CalendarRange, permission: "PAY_PERIOD_MANAGE" },
      {
        label: "Timecards",
        href: "/payroll/timecards",
        icon: FileSpreadsheet,
        permission: ["TIMECARD_VIEW_TEAM", "TIMECARD_VIEW_ANY", "TIMECARD_EDIT_TEAM", "TIMECARD_EDIT_ANY"],
      },
      { label: "Reports", href: "/reports", icon: BarChart3, permission: "REPORT_MANAGE" },
    ],
  },
  {
    id: "admin",
    icon: Cog,
    railLabel: "Admin",
    label: "Administration",
    href: "/admin",
    prefixes: ["/admin"],
    items: [
      { label: "Employees", href: "/admin/employees", icon: IdCard, permission: "EMPLOYEE_MANAGE" },
      {
        label: "Company Setup",
        href: "/admin/site-settings",
        icon: Layers,
        permission: ["SITE_MANAGE", "RULES_MANAGE", "PAY_PERIOD_MANAGE"],
      },
      { label: "Rules Setup", href: "/admin/rules-setup", icon: BookOpen, permission: "RULES_MANAGE" },
      { label: "Roles & Permissions", href: "/admin/roles", icon: ShieldCheck, permission: "ROLE_MANAGE" },
      { label: "ADP Sync", href: "/admin/adp", icon: RefreshCw, permission: "EMPLOYEE_MANAGE" },
      { label: "Integrations", href: "/admin/api-keys", icon: KeyRound, permission: "SITE_MANAGE" },
      { label: "Audit Log", href: "/admin/audit", icon: ScrollText, permission: "AUDIT_VIEW" },
      { label: "Company Settings", href: "/admin/settings", icon: SlidersHorizontal, permission: "PAY_PERIOD_MANAGE" },
    ],
  },
];

/**
 * The Administration hub's destinations, without icons.
 *
 * <p>Data only, so the hub page and the command palette read the same list.
 * The hub attaches an icon to each by href; the palette does not need one.
 *
 * <p>The hrefs point at real pages with the right tab. Nine /admin/* routes
 * (sites, departments, leave-types, pto-policies, rules, pay-codes,
 * reason-codes, holidays, shifts) are one-line redirect stubs that all land on
 * /admin/site-settings, most without selecting a tab — linking to those is how
 * the old hub ended up with five cards that went to the same screen.
 */
export const ADMIN_GROUPS: {
  label: string;
  hint: string;
  items: { label: string; detail: string; href: string; permission: string }[];
}[] = [
  {
    label: "People & HR",
    hint: "Who works here, and who can change what",
    items: [
      { label: "Employees", detail: "Profiles, badge numbers and shift assignments", href: "/admin/employees", permission: "EMPLOYEE_MANAGE" },
      { label: "Departments", detail: "Cost centres and reporting lines", href: "/admin/site-settings?tab=departments", permission: "SITE_MANAGE" },
      { label: "Roles & Permissions", detail: "What each role can see and change", href: "/admin/roles", permission: "ROLE_MANAGE" },
      { label: "Audit Log", detail: "Every configuration and timecard change", href: "/admin/audit", permission: "AUDIT_VIEW" },
    ],
  },
  {
    label: "Organization",
    hint: "Where and when people are scheduled to work",
    items: [
      { label: "Sites", detail: "Facilities, time zones and timeclocks", href: "/admin/site-settings?tab=sites", permission: "SITE_MANAGE" },
      { label: "Shifts", detail: "Shift patterns and who they apply to", href: "/admin/rules-setup?tab=shifts", permission: "RULES_MANAGE" },
      { label: "Holidays", detail: "Observed dates, per site", href: "/admin/site-settings?tab=holidays", permission: "RULES_MANAGE" },
    ],
  },
  {
    label: "Pay & Rules",
    hint: "How raw punches become payable hours",
    items: [
      { label: "Pay Rules", detail: "Overtime, rounding, meal and grace rules", href: "/admin/rules-setup?tab=rule-sets", permission: "RULES_MANAGE" },
      { label: "Pay Codes", detail: "How hours map to payroll earnings", href: "/admin/site-settings?tab=pay-codes", permission: "RULES_MANAGE" },
      { label: "Reason Codes", detail: "Why a punch was edited, missed or excused", href: "/admin/site-settings?tab=reason-codes", permission: "RULES_MANAGE" },
      { label: "Pay Periods", detail: "Period length and close schedule", href: "/payroll/pay-periods", permission: "PAY_PERIOD_MANAGE" },
    ],
  },
  {
    label: "Leave & Absence",
    hint: "What time off exists and how it accrues",
    items: [
      { label: "Leave Types", detail: "Paid and unpaid absence categories", href: "/admin/site-settings?tab=leave-types", permission: "RULES_MANAGE" },
      { label: "PTO Policies", detail: "Accrual method, caps and eligibility", href: "/admin/rules-setup?tab=leave-policies", permission: "RULES_MANAGE" },
      { label: "Accrual Runs", detail: "Nightly accrual postings and their results", href: "/accruals", permission: "ACCRUAL_VIEW_ANY" },
    ],
  },
  {
    label: "System",
    hint: "Connections, credentials and company-wide defaults",
    items: [
      { label: "Integrations", detail: "Keys used by timeclocks and exports", href: "/admin/api-keys", permission: "SITE_MANAGE" },
      { label: "ADP Sync", detail: "Sync employee data from ADP Workforce Now", href: "/admin/adp", permission: "EMPLOYEE_MANAGE" },
      { label: "WMS Sync", detail: "Employee, schedule and gate data from the warehouse", href: "/admin/wms-sync", permission: "EMPLOYEE_MANAGE" },
      { label: "Company Settings", detail: "Defaults applied to every site unless overridden", href: "/admin/settings", permission: "PAY_PERIOD_MANAGE" },
    ],
  },
];

export const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: "Employee",
  SUPERVISOR: "Supervisor",
  PAYROLL_ADMIN: "Payroll Admin",
  HR_ADMIN: "HR Admin",
  SYSTEM_ADMIN: "System Admin",
  SUPER_ADMIN: "Super Admin",
};

/** What an inactive employee may still open: their own past records, read-only. */
export const INACTIVE_ALLOWED_HREFS = ["/time/timesheet", "/time/history", "/documents"];

/**
 * Longest match wins, so /payroll/timecards highlights Timecards rather than
 * Pay Periods. Matching on the href plus a slash, rather than a bare prefix,
 * keeps /payroll from claiming a future /payroll-archive.
 */
export function activeHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      if (!best || href.length > best.length) best = href;
    }
  }
  return best;
}

/**
 * The section and page the current path sits in, for the breadcrumb.
 *
 * <p>Falls back to the section when the path is not itself a nav destination,
 * so a record page (/admin/sites/abc123) still says Administration rather than
 * showing nothing at all.
 */
export function locate(pathname: string): { section: NavSection; item: NavItem | null } | null {
  const all = SECTIONS.flatMap((s) => s.items.map((i) => ({ section: s, item: i })));
  const href = activeHref(pathname, all.map((e) => e.item.href));
  if (href) return all.find((e) => e.item.href === href) ?? null;

  const section = SECTIONS.find((s) =>
    s.prefixes.some((p) => pathname === p || pathname.startsWith(p + "/")),
  );
  return section ? { section, item: null } : null;
}
