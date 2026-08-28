"use client";

import { useState } from "react";
import { Settings, Clock, BookOpen, CalendarClock, ChevronRight } from "lucide-react";
import { RuleSetsManager } from "@/components/admin/rule-sets-manager";
import { ShiftsManager } from "@/components/admin/shifts-manager";
import { HolidayRulesManager } from "@/components/admin/holiday-rules-manager";
import { PtoPoliciesManager } from "@/components/admin/pto-policies-manager";
import type { RuleSet } from "@prisma/client";

type Tab = "rule-sets" | "shifts" | "holiday-rules" | "leave-policies";

interface TabDef {
  id: Tab;
  label: string;
  icon: React.ElementType;
  title: string;
  description?: string;
  group?: string;
}

interface GroupDef {
  id: string;
  label: string;
  icon: React.ElementType;
}

const TABS: TabDef[] = [
  {
    id: "rule-sets",
    label: "Rule Sets",
    icon: Settings,
    title: "Rule Sets",
    description: "Define overtime thresholds, rounding, meal rules, and pay period configuration.",
  },
  {
    id: "shifts",
    label: "Shifts",
    icon: Clock,
    title: "Shifts",
    description: "Define shift types with start and end times to assign to employees.",
  },
  {
    id: "holiday-rules",
    label: "Holiday Rules",
    icon: BookOpen,
    title: "Holiday Rules",
    description: "Define how holiday pay is calculated — credit method, working premium, and eligibility requirements.",
  },
  {
    id: "leave-policies",
    label: "Leave Policies",
    icon: CalendarClock,
    title: "Leave Policies",
    description: "Define tenure-based accrual rules per leave type. Assign policies to sites or individual employees.",
  },
];

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ruleSets: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shifts: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  holidayRules: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ptoPolicies: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leaveTypes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payCodes: any[];
  initialTab?: string;
}

export function RulesSetupClient({
  ruleSets,
  shifts,
  holidayRules,
  ptoPolicies,
  leaveTypes,
  payCodes,
  initialTab,
}: Props) {
  const defaultTab =
    initialTab && TABS.some((t) => t.id === initialTab)
      ? (initialTab as Tab)
      : TABS[0].id;

  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  const current = TABS.find((t) => t.id === activeTab);

  return (
    <div
      className="mt-6 flex overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
      style={{ minHeight: "600px" }}
    >
      {/* ── Left nav ─────────────────────────────────────────────────── */}
      <nav className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
        <ul className="py-2">
          {TABS.map((tab) => {
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

            {activeTab === "rule-sets" && (
              <RuleSetsManager ruleSets={ruleSets as RuleSet[]} payCodes={payCodes} />
            )}
            {activeTab === "shifts" && <ShiftsManager shifts={shifts} />}
            {activeTab === "holiday-rules" && (
              <HolidayRulesManager rules={holidayRules} payCodes={payCodes} />
            )}
            {activeTab === "leave-policies" && (
              <PtoPoliciesManager policies={ptoPolicies} leaveTypes={leaveTypes} payCodes={payCodes} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
