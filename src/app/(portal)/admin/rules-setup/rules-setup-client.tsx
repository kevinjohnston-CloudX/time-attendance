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

/** Areas not yet on the shared panel still draw their own heading. */
const HINT: Partial<Record<Tab, string>> = {
  "leave-policies": "How time off builds up with tenure, by leave type. Assigned to sites or to individual employees.",
};

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
  leaveTypes: any[];
  payCodes: any[];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  initialTab?: string;
  initialPolicyId?: string;
  initialRuleSetView?: string;
}

export function RulesSetupClient(props: Props) {
  const { ruleSets, shifts, holidayRules, ptoPolicies, leaveTypes, payCodes, initialTab, initialPolicyId, initialRuleSetView } =
    props;
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
  const hint = HINT[tab];

  return (
    <SetupShell
      title="Rules Setup"
      subtitle="Overtime, rounding, meals, shifts, holiday pay and time off"
      path="/admin/rules-setup"
      groups={groups}
      active={tab}
      onPick={setTab}
    >
      {hint && (
        <div className="flex flex-col gap-0.5">
          <h2 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>{LABEL[tab]}</h2>
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)", textWrap: "pretty" }}>{hint}</p>
        </div>
      )}
      {tab === "rule-sets" && <RuleSetsManager ruleSets={ruleSets} initialView={initialRuleSetView} />}
      {tab === "shifts" && <ShiftsManager shifts={shifts} />}
      {tab === "holiday-rules" && <HolidayRulesManager rules={holidayRules} payCodes={payCodes} />}
      {tab === "leave-policies" && (
        <PtoPoliciesManager policies={ptoPolicies} leaveTypes={leaveTypes} payCodes={payCodes} initialPolicyId={initialPolicyId} />
      )}
    </SetupShell>
  );
}
