"use client";

import { useState, type ElementType } from "react";
import { Building2, CalendarDays, FolderOpen, Layers, MessageSquare, Palmtree, Receipt, Tag } from "lucide-react";
import { SetupShell } from "@/components/admin/setup/setup-shell";
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
 * Company Setup: eight lists behind one screen, in the frame it shares with
 * Rules Setup (see SetupShell). The server component above loads all eight
 * in one round, so switching areas never refetches. Which areas show is
 * decided by the permissions the page was given; each area's actions check
 * them again.
 */

type DepartmentWithSites = Department & { sites: { site: Site }[] };

type Tab = "sites" | "departments" | "holidays" | "leave-types" | "pay-codes" | "reason-codes" | "pay-categories" | "pay-types";

interface AreaDef {
  id: Tab;
  label: string;
  icon: ElementType;
  requires: "site" | "rules" | "payroll";
}

const GROUPS: { title: string; areas: AreaDef[] }[] = [
  {
    title: "Organization",
    areas: [
      { id: "sites", label: "Sites", icon: Building2, requires: "site" },
      { id: "departments", label: "Departments", icon: FolderOpen, requires: "site" },
    ],
  },
  {
    title: "Time off",
    areas: [
      { id: "holidays", label: "Holidays", icon: CalendarDays, requires: "rules" },
      { id: "leave-types", label: "Leave types", icon: Palmtree, requires: "rules" },
    ],
  },
  {
    title: "Payroll",
    areas: [
      { id: "pay-categories", label: "Pay categories", icon: Layers, requires: "rules" },
      { id: "pay-types", label: "Pay types", icon: Tag, requires: "rules" },
      { id: "pay-codes", label: "Pay codes", icon: Receipt, requires: "payroll" },
      { id: "reason-codes", label: "Reason codes", icon: MessageSquare, requires: "payroll" },
    ],
  },
];

interface Props {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  sites: any[];
  departments: any[];
  holidays: any[];
  leaveTypes: any[];
  payCodes: any[];
  reasonCodes: any[];
  ptoPolicies: any[];
  holidayRules: any[];
  payCategories: any[];
  payTypes: any[];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  hasSiteManage: boolean;
  hasRulesManage: boolean;
  hasPayPeriodManage: boolean;
  initialTab?: string;
}

export function SiteSettingsClient(props: Props) {
  const { hasSiteManage, hasRulesManage, hasPayPeriodManage, initialTab } = props;
  const allowed = (r: AreaDef["requires"]) =>
    (r === "site" && hasSiteManage) || (r === "rules" && hasRulesManage) || (r === "payroll" && hasPayPeriodManage);

  const activeCount: Record<Tab, number> = {
    sites: props.sites.filter((x) => x.isActive).length,
    departments: props.departments.filter((x) => x.isActive).length,
    holidays: props.holidays.filter((x) => x.isActive).length,
    "leave-types": props.leaveTypes.filter((x) => x.isActive).length,
    "pay-categories": props.payCategories.filter((x) => x.isActive).length,
    "pay-types": props.payTypes.filter((x) => x.isActive).length,
    "pay-codes": props.payCodes.filter((x) => x.isActive).length,
    "reason-codes": props.reasonCodes.filter((x) => x.isActive).length,
  };

  const groups = GROUPS.map((g) => ({
    title: g.title,
    areas: g.areas.filter((a) => allowed(a.requires)).map((a) => ({ ...a, count: activeCount[a.id] })),
  })).filter((g) => g.areas.length);
  const areas = groups.flatMap((g) => g.areas);

  const [active, setActive] = useState<Tab>(() =>
    areas.some((a) => a.id === initialTab) ? (initialTab as Tab) : (areas[0]?.id ?? "sites"),
  );

  return (
    <SetupShell
      title="Company Setup"
      subtitle="Sites, departments, holidays and the codes payroll uses"
      path="/admin/site-settings"
      groups={groups}
      active={active}
      onPick={setActive}
    >
      <AreaBody tab={active} {...props} />
    </SetupShell>
  );
}

function AreaBody({ tab, ...p }: Props & { tab: Tab }) {
  switch (tab) {
    case "sites":
      return <SitesManager sites={p.sites as Site[]} />;
    case "departments":
      return <DepartmentsManager departments={p.departments as DepartmentWithSites[]} sites={p.sites as Site[]} />;
    case "holidays":
      return <HolidaysManager holidays={p.holidays} holidayRules={p.holidayRules} />;
    case "leave-types":
      return <LeaveTypesManager leaveTypes={p.leaveTypes} payCodes={p.payCodes} />;
    case "pay-categories":
      return <PayCategoriesManager categories={p.payCategories} ptoPolicies={p.ptoPolicies} leaveTypes={p.leaveTypes} />;
    case "pay-types":
      return <PayTypesManager payTypes={p.payTypes} />;
    case "pay-codes":
      return <PayCodesManager payCodes={p.payCodes} />;
    case "reason-codes":
      return <ReasonCodesManager reasonCodes={p.reasonCodes} />;
  }
}
