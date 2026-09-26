"use client";

import { useState } from "react";
import { BookOpen, CalendarClock, Clock, SlidersHorizontal } from "lucide-react";
import { SetupShell } from "@/components/admin/setup/setup-shell";
import { RuleSetsManager } from "@/components/admin/rule-sets-manager";
import { ShiftsManager } from "@/components/admin/shifts-manager";
import { HolidayRulesManager } from "@/components/admin/holiday-rules-manager";
import { PtoPoliciesManager } from "@/components/admin/pto-policies-manager";

/**
 * Rules Setup: four areas behind one screen, in the frame it shares with
 * Company Setup (see SetupShell). The server component above fetched all
 * six datasets in one round, so switching areas never refetches. `?tab=`
 * still picks the area on arrival, which the hub links and the accrual
 * screen's "open this policy" link depend on.
 */

type Tab = "rule-sets" | "shifts" | "holiday-rules" | "leave-policies";

const LABEL: Record<Tab, string> = {
  "rule-sets": "Rule sets",
  shifts: "Shifts",
  "holiday-rules": "Holiday rules",
  "leave-policies": "Leave policies",
};

interface Props {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  ruleSets: any[];
  shifts: any[];
  holidayRules: any[];
  ptoPolicies: any[];
  payCodes: any[];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  initialTab?: string;
  initialRuleSetView?: string;
}

export function RulesSetupClient(props: Props) {
  const { ruleSets, shifts, holidayRules, ptoPolicies, payCodes, initialTab, initialRuleSetView } = props;
  const active = (rows: { isActive: boolean }[]) => rows.filter((r) => r.isActive).length;

  const groups: { title: string; areas: { id: Tab; label: string; icon: typeof Clock; count: number }[] }[] = [
    {
      title: "Time and pay",
      areas: [
        { id: "rule-sets", label: LABEL["rule-sets"], icon: SlidersHorizontal, count: active(ruleSets) },
        { id: "shifts", label: LABEL.shifts, icon: Clock, count: active(shifts) },
      ],
    },
    {
      title: "Time off",
      areas: [
        { id: "holiday-rules", label: LABEL["holiday-rules"], icon: BookOpen, count: active(holidayRules) },
        { id: "leave-policies", label: LABEL["leave-policies"], icon: CalendarClock, count: active(ptoPolicies) },
      ],
    },
  ];

  const [tab, setTab] = useState<Tab>(() => (initialTab && initialTab in LABEL ? (initialTab as Tab) : "rule-sets"));

  return (
    <SetupShell
      title="Rules Setup"
      subtitle="Overtime, rounding, meals, shifts, holiday pay and time off"
      path="/admin/rules-setup"
      groups={groups}
      active={tab}
      onPick={setTab}
    >
      {tab === "rule-sets" && <RuleSetsManager ruleSets={ruleSets} initialView={initialRuleSetView} />}
      {tab === "shifts" && <ShiftsManager shifts={shifts} />}
      {tab === "holiday-rules" && <HolidayRulesManager rules={holidayRules} payCodes={payCodes} />}
      {tab === "leave-policies" && (
        <PtoPoliciesManager policies={ptoPolicies} />
      )}
    </SetupShell>
  );
}
