"use client";

import { useState } from "react";
import { Building2, FolderOpen, Palmtree, Calendar, Tag, MessageSquare, Layers } from "lucide-react";
import { SitesManager } from "@/components/admin/sites-manager";
import { DepartmentsManager } from "@/components/admin/departments-manager";
import { HolidaysManager } from "@/components/admin/holidays-manager";
import { LeaveTypesManager } from "@/components/admin/leave-types-manager";
import { PayCodesManager } from "@/components/admin/pay-codes-manager";
import { ReasonCodesManager } from "@/components/admin/reason-codes-manager";
import { PayCategoriesManager } from "@/components/admin/pay-categories-manager";
import { PayTypesManager } from "@/components/admin/pay-types-manager";
import type { Site, Department } from "@prisma/client";

/**
 * Company Setup — eight editors behind one screen.
 *
 * <p>Laid out like the Administration hub it is reached from: the areas in a
 * card at the top, the open one below it. The previous split pane put the
 * editors on --surface-card, and every manager below builds its rows out of
 * .ta-card — cards on a card, told apart only by a shadow. On the page
 * background they read as panels again, which is how the same rows look on
 * every other screen in the product.
 *
 * <p>The area is React state rather than a query parameter. Switching it does
 * not re-query: the server component above already fetched all eight datasets
 * in one round, so a link per area would refetch ten server actions to reveal
 * rows the browser is holding. `?tab=` still chooses the area on arrival,
 * which is what the hub links depend on.
 */

type DepartmentWithSites = Department & { sites: { site: Site }[] };

type Tab = "sites" | "departments" | "holidays" | "leave-types" | "pay-codes" | "reason-codes" | "pay-categories" | "pay-types";

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

  // Resolved against the visible tabs, not all of them, so an area this
  // viewer may not manage can never end up open.
  const current = visibleTabs.find((t) => t.id === activeTab);

  return (
    <div className="flex flex-col gap-4">
      <section className="ta-card flex flex-col gap-2.5 rounded-xl p-4">
        <span className="wms-overline">Setup areas</span>
        <div className="grid gap-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))]">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveTab(tab.id)}
                className="ta-hoverable flex items-center gap-2.5 rounded-lg px-3 py-2 text-left"
                data-active={active ? "true" : undefined}
                style={{
                  border: "none",
                  cursor: "pointer",
                  background: active ? "var(--wms-color-primary-50)" : "transparent",
                  color: active ? "var(--text-accent)" : "var(--text-primary)",
                  font: "var(--type-body1)",
                  fontWeight: active ? "var(--weight-semibold)" : "var(--weight-medium)",
                }}
              >
                <Icon
                  className="h-[18px] w-[18px] flex-none"
                  style={{ color: active ? "var(--icon-accent)" : "var(--icon-tertiary)" }}
                />
                <span className="min-w-0 flex-1 truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {current && (
        <div className="flex flex-col">
          <div className="flex flex-col gap-0.5">
            <h2 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
              {current.title}
            </h2>
            {current.description && (
              <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                {current.description}
              </p>
            )}
          </div>

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
        </div>
      )}
    </div>
  );
}
