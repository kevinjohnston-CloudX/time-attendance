"use client";

import { useState } from "react";
import { Building2, FolderOpen, Settings, Palmtree, Calendar, Tag, MessageSquare, CalendarClock, Clock, BookOpen, Layers, Sliders, ChevronRight } from "lucide-react";
import { SitesManager } from "@/components/admin/sites-manager";
import { DepartmentsManager } from "@/components/admin/departments-manager";
import { RuleSetsManager } from "@/components/admin/rule-sets-manager";
import { HolidaysManager } from "@/components/admin/holidays-manager";
import { LeaveTypesManager } from "@/components/admin/leave-types-manager";
import { PayCodesManager } from "@/components/admin/pay-codes-manager";
import { ReasonCodesManager } from "@/components/admin/reason-codes-manager";
import { PtoPoliciesManager } from "@/components/admin/pto-policies-manager";
import { ShiftsManager } from "@/components/admin/shifts-manager";
import { HolidayRulesManager } from "@/components/admin/holiday-rules-manager";
import { PayCategoriesManager } from "@/components/admin/pay-categories-manager";
import type { Site, Department, RuleSet, Holiday } from "@prisma/client";

type DepartmentWithSites = Department & { sites: { site: Site }[] };

type Tab = "sites" | "departments" | "rule-sets" | "holidays" | "holiday-rules" | "leave-types" | "pay-codes" | "reason-codes" | "pto-policies" | "shifts" | "pay-categories";

interface TabDef {
  id: Tab;
  label: string;
  icon: React.ElementType;
  requires: "site" | "rules" | "payroll";
  title: string;
  description?: string;
  group?: string;
}

interface GroupDef {
  id: string;
  label: string;
  icon: React.ElementType;
  requires: "site" | "rules" | "payroll";
}

const GROUPS: GroupDef[] = [
  { id: "employee-settings", label: "Employee Settings", icon: Sliders, requires: "rules" },
];

const TABS: TabDef[] = [
  { id: "sites",         label: "Sites",         icon: Building2,     requires: "site",    title: "Sites" },
  { id: "departments",   label: "Departments",   icon: FolderOpen,    requires: "site",    title: "Departments" },
  { id: "rule-sets",     label: "Rule Sets",     icon: Settings,      requires: "rules",   title: "Rule Sets",       group: "employee-settings" },
  { id: "shifts",        label: "Shifts",        icon: Clock,         requires: "rules",   title: "Shifts",          group: "employee-settings",
    description: "Define shift types with start and end times to assign to employees." },
  { id: "holiday-rules",    label: "Holiday Rules",    icon: BookOpen, requires: "rules", title: "Holiday Rules",    group: "employee-settings",
    description: "Define how holiday pay is calculated — credit method, working premium, and eligibility requirements." },
  { id: "pay-categories",   label: "Pay Categories",   icon: Layers,   requires: "rules", title: "Pay Categories",   group: "employee-settings",
    description: "Define pay category codes and descriptions used to classify employees for payroll." },
  { id: "holidays",      label: "Holidays",      icon: Palmtree,      requires: "rules",   title: "Holidays",
    description: "Manage company holidays. Holidays can be used when submitting leave requests." },
  { id: "leave-types",   label: "Leave Types",   icon: Calendar,      requires: "rules",   title: "Leave Types" },
  { id: "pto-policies",  label: "Leave Policies",  icon: CalendarClock, requires: "rules",   title: "Leave Policies",
    description: "Define tenure-based accrual rules per leave type. Assign policies to sites or individual employees." },
  { id: "pay-codes",     label: "Pay Codes",     icon: Tag,           requires: "payroll", title: "Pay Codes",
    description: "Manage numeric pay codes used for payroll export and segment classification." },
  { id: "reason-codes",  label: "Reason Codes",  icon: MessageSquare, requires: "payroll", title: "Reason Codes",
    description: "Manage reason codes that can be assigned to timecard entries." },
];

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sites: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  departments: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ruleSets: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  holidays: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leaveTypes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payCodes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reasonCodes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ptoPolicies: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shifts: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  holidayRules: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payCategories: any[];
  hasSiteManage: boolean;
  hasRulesManage: boolean;
  hasPayPeriodManage: boolean;
  initialTab?: string;
}

export function SiteSettingsClient({
  sites,
  departments,
  ruleSets,
  holidays,
  leaveTypes,
  payCodes,
  reasonCodes,
  ptoPolicies,
  shifts,
  holidayRules,
  payCategories,
  hasSiteManage,
  hasRulesManage,
  hasPayPeriodManage,
  initialTab,
}: Props) {
  const permCheck = (requires: TabDef["requires"]) =>
    (requires === "site"    && hasSiteManage) ||
    (requires === "rules"   && hasRulesManage) ||
    (requires === "payroll" && hasPayPeriodManage);

  const visibleTabs = TABS.filter((t) => permCheck(t.requires));

  const defaultTab =
    initialTab && visibleTabs.some((t) => t.id === initialTab)
      ? (initialTab as Tab)
      : (visibleTabs[0]?.id ?? "sites");

  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  const initialOpenGroups = new Set<string>(
    TABS.find((t) => t.id === defaultTab)?.group ? [TABS.find((t) => t.id === defaultTab)!.group!] : []
  );
  const [openGroups, setOpenGroups] = useState<Set<string>>(initialOpenGroups);

  function toggleGroup(groupId: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  const current = TABS.find((t) => t.id === activeTab);

  type NavItem =
    | { kind: "tab"; tab: TabDef }
    | { kind: "group"; group: GroupDef };

  const navItems: NavItem[] = [];
  const seenGroups = new Set<string>();

  for (const tab of visibleTabs) {
    if (tab.group) {
      if (!seenGroups.has(tab.group)) {
        const group = GROUPS.find((g) => g.id === tab.group && permCheck(g.requires));
        if (group) {
          navItems.push({ kind: "group", group });
          seenGroups.add(tab.group);
        }
      }
    }
    navItems.push({ kind: "tab", tab });
  }

  return (
    <div className="mt-6 flex overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800" style={{ minHeight: "600px" }}>
      {/* ── Left nav ─────────────────────────────────────────────────── */}
      <nav className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
        <ul className="py-2">
          {navItems.map((item) => {
            if (item.kind === "group") {
              const { group } = item;
              const Icon = group.icon;
              const isOpen = openGroups.has(group.id);
              return (
                <li key={`group:${group.id}`}>
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left">{group.label}</span>
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
                    />
                  </button>
                </li>
              );
            }

            const { tab } = item;
            if (tab.group && !openGroups.has(tab.group)) return null;

            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const isGrouped = !!tab.group;

            return (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex w-full items-center gap-2.5 py-2.5 text-sm transition-colors ${
                    isGrouped ? "pl-7 pr-4" : "px-4"
                  } ${
                    isActive
                      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {tab.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Right content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto bg-white p-6 dark:bg-zinc-950">
        {current && (
          <>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{current.title}</h2>
            {current.description && (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{current.description}</p>
            )}

            {activeTab === "sites" && (
              <SitesManager sites={sites as Site[]} />
            )}
            {activeTab === "departments" && (
              <DepartmentsManager
                departments={departments as DepartmentWithSites[]}
                sites={sites as Site[]}
              />
            )}
            {activeTab === "rule-sets" && (
              <RuleSetsManager ruleSets={ruleSets as RuleSet[]} payCodes={payCodes} />
            )}
            {activeTab === "shifts" && (
              <ShiftsManager shifts={shifts} />
            )}
            {activeTab === "holidays" && (
              <HolidaysManager holidays={holidays as Holiday[]} />
            )}
            {activeTab === "holiday-rules" && (
              <HolidayRulesManager rules={holidayRules} />
            )}
            {activeTab === "pay-categories" && (
              <PayCategoriesManager categories={payCategories} ptoPolicies={ptoPolicies} leaveTypes={leaveTypes} />
            )}
            {activeTab === "leave-types" && (
              <LeaveTypesManager leaveTypes={leaveTypes} payCodes={payCodes} />
            )}
            {activeTab === "pto-policies" && (
              <PtoPoliciesManager policies={ptoPolicies} leaveTypes={leaveTypes} payCodes={payCodes} />
            )}
            {activeTab === "pay-codes" && (
              <PayCodesManager payCodes={payCodes} />
            )}
            {activeTab === "reason-codes" && (
              <ReasonCodesManager reasonCodes={reasonCodes} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
