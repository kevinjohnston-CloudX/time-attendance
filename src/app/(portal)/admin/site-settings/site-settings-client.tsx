"use client";

import { useState } from "react";
import { Building2, FolderOpen, Palmtree, Calendar, Tag, MessageSquare, CalendarClock, Layers, ChevronRight, Briefcase, Users } from "lucide-react";
import { SitesManager } from "@/components/admin/sites-manager";
import { DepartmentsManager } from "@/components/admin/departments-manager";
import { HolidaysManager } from "@/components/admin/holidays-manager";
import { LeaveTypesManager } from "@/components/admin/leave-types-manager";
import { PayCodesManager } from "@/components/admin/pay-codes-manager";
import { ReasonCodesManager } from "@/components/admin/reason-codes-manager";
import { PayCategoriesManager } from "@/components/admin/pay-categories-manager";
import { PayTypesManager } from "@/components/admin/pay-types-manager";
import { JobTitlesManager } from "@/components/admin/job-titles-manager";
import { AgenciesManager } from "@/components/admin/agencies-manager";
import type { Site, Department } from "@prisma/client";

type DepartmentWithSites = Department & { sites: { site: Site }[] };

type Tab = "sites" | "departments" | "holidays" | "leave-types" | "pay-codes" | "reason-codes" | "pay-categories" | "pay-types" | "job-titles" | "agencies";

interface TabDef {
  id: Tab;
  label: string;
  icon: React.ElementType;
  requires: "site" | "rules" | "payroll";
  title: string;
  description?: string;
}

const TABS: TabDef[] = [
  { id: "sites",          label: "Sites",          icon: Building2,     requires: "site",    title: "Sites" },
  { id: "departments",    label: "Departments",    icon: FolderOpen,    requires: "site",    title: "Departments" },
  { id: "holidays",       label: "Holidays",       icon: Palmtree,      requires: "rules",   title: "Holidays",
    description: "Manage company holidays. Assign them to holiday rules for pay calculation." },
  { id: "leave-types",    label: "Leave Types",    icon: Calendar,      requires: "rules",   title: "Leave Types" },
  { id: "pay-categories", label: "Pay Categories", icon: Layers,        requires: "rules",   title: "Pay Categories",
    description: "Define pay category codes and descriptions used to classify employees for payroll." },
  { id: "pay-types",      label: "Pay Types",      icon: Tag,           requires: "rules",   title: "Pay Types",
    description: "Define pay type codes and descriptions (e.g. Non-Exempt, Exempt) used to classify employees." },
  { id: "pay-codes",      label: "Pay Codes",      icon: Tag,           requires: "payroll", title: "Pay Codes",
    description: "Manage numeric pay codes used for payroll export and segment classification." },
  { id: "reason-codes",   label: "Reason Codes",   icon: MessageSquare, requires: "payroll", title: "Reason Codes",
    description: "Manage reason codes that can be assigned to timecard entries." },
  { id: "job-titles",     label: "Job Titles",     icon: Briefcase,     requires: "rules",   title: "Job Titles",
    description: "Define job titles and their associated ID or code used in payroll or HR systems." },
  { id: "agencies",       label: "Agencies",       icon: Users,         requires: "rules",   title: "Agencies",
    description: "Define staffing agencies with their code, rates, and work hour limits." },
];

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sites: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  departments: any[];
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
  holidayRules: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payCategories: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payTypes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jobTitles: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agencies: any[];
  hasSiteManage: boolean;
  hasRulesManage: boolean;
  hasPayPeriodManage: boolean;
  initialTab?: string;
}

export function SiteSettingsClient({
  sites,
  departments,
  holidays,
  leaveTypes,
  payCodes,
  reasonCodes,
  ptoPolicies,
  holidayRules,
  payCategories,
  payTypes,
  jobTitles,
  agencies,
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

  const current = TABS.find((t) => t.id === activeTab);

  return (
    <div className="mt-6 flex overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800" style={{ minHeight: "600px" }}>
      {/* ── Left nav ─────────────────────────────────────────────────── */}
      <nav className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
        <ul className="py-2">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
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
            {activeTab === "holidays" && (
              <HolidaysManager holidays={holidays} holidayRules={holidayRules} />
            )}
            {activeTab === "leave-types" && (
              <LeaveTypesManager leaveTypes={leaveTypes} payCodes={payCodes} />
            )}
            {activeTab === "pay-categories" && (
              <PayCategoriesManager categories={payCategories} ptoPolicies={ptoPolicies} leaveTypes={leaveTypes} />
            )}
            {activeTab === "pay-types" && (
              <PayTypesManager payTypes={payTypes} />
            )}
            {activeTab === "pay-codes" && (
              <PayCodesManager payCodes={payCodes} />
            )}
            {activeTab === "reason-codes" && (
              <ReasonCodesManager reasonCodes={reasonCodes} />
            )}
            {activeTab === "job-titles" && (
              <JobTitlesManager jobTitles={jobTitles} />
            )}
            {activeTab === "agencies" && (
              <AgenciesManager agencies={agencies} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
