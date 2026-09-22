"use client";

import { useState } from "react";
import { Settings, Clock, BookOpen, CalendarClock } from "lucide-react";
import { RuleSetsManager } from "@/components/admin/rule-sets-manager";
import { ShiftsManager } from "@/components/admin/shifts-manager";
import { HolidayRulesManager } from "@/components/admin/holiday-rules-manager";
import { PtoPoliciesManager } from "@/components/admin/pto-policies-manager";
import type { RuleSet } from "@prisma/client";

/**
 * Rules Setup — four editors behind one screen.
 *
 * <p>Laid out like the Administration hub it is reached from, and like its
 * sibling Company Setup: the areas in a card at the top, the open one below
 * it. The previous left rail put the editors on --surface-card while every
 * manager below builds its rows out of .ta-card, so the rows read as cards on
 * a card. On the page background they read as panels again.
 *
 * <p>The area is React state rather than a query parameter. Switching it does
 * not re-query: the server component above already fetched all six datasets in
 * one round, so a link per area would re-run six server actions to reveal rows
 * the browser is already holding. `?tab=` still chooses the area on arrival,
 * which is what the hub links and the accrual screen's "open this policy" link
 * depend on.
 */

type Tab = "rule-sets" | "shifts" | "holiday-rules" | "leave-policies";

interface TabDef {
  id: Tab;
  label: string;
  icon: React.ElementType;
  title: string;
  description?: string;
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
  initialPolicyId?: string;
  initialRuleSetView?: string;
}

export function RulesSetupClient({
  ruleSets,
  shifts,
  holidayRules,
  ptoPolicies,
  leaveTypes,
  payCodes,
  initialTab,
  initialPolicyId,
  initialRuleSetView,
}: Props) {
  const defaultTab =
    initialTab && TABS.some((t) => t.id === initialTab) ? (initialTab as Tab) : TABS[0].id;

  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  const current = TABS.find((t) => t.id === activeTab);

  /** How many rows sit behind each area, so the rail says what is in there. */
  const counts: Record<Tab, number> = {
    "rule-sets": ruleSets.length,
    shifts: shifts.length,
    "holiday-rules": holidayRules.length,
    "leave-policies": ptoPolicies.length,
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="ta-card flex flex-col gap-2.5 rounded-xl p-4">
        <span className="wms-overline">Rule areas</span>
        <div className="grid gap-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))]">
          {TABS.map((tab) => {
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
                <span
                  className="tabular flex-none"
                  style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                >
                  {counts[tab.id]}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* No gap on this stack: each manager opens with its own top margin, and
          three of the four are owned elsewhere — adding a gap here would space
          them differently from every other settings screen. */}
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

          {activeTab === "rule-sets" && (
            <RuleSetsManager
              ruleSets={ruleSets as RuleSet[]}
              payCodes={payCodes}
              initialView={initialRuleSetView}
            />
          )}
          {activeTab === "shifts" && <ShiftsManager shifts={shifts} />}
          {activeTab === "holiday-rules" && (
            <HolidayRulesManager rules={holidayRules} payCodes={payCodes} />
          )}
          {activeTab === "leave-policies" && (
            <PtoPoliciesManager
              policies={ptoPolicies}
              leaveTypes={leaveTypes}
              payCodes={payCodes}
              initialPolicyId={initialPolicyId}
            />
          )}
        </div>
      )}
    </div>
  );
}
