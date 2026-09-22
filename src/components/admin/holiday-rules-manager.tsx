"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, ChevronDown, X } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { createHolidayRule, updateHolidayRule, deleteHolidayRule } from "@/actions/holiday-rule.actions";
import type { HolidayRule } from "@prisma/client";
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  SearchInput,
  Select,
  SegmentedControl,
  Table,
  TBody,
  THead,
  TR,
  TH,
  TD,
  TableFooter,
  Toolbar,
  statusTone,
} from "@/components/ui";

/**
 * Holiday rules — the list on the design's list template, the editor in a
 * dialog behind it.
 *
 * <p>The editor is not on the design's field grid, and deliberately so. These
 * rules are sentences with numbers in them — "must work at least 3 days within
 * the last 2 weeks before the holiday" — and breaking each clause into a
 * labelled field loses the sentence, which is the only thing that says what the
 * rule does. The controls are the design system's; the layout is prose with
 * fields in it.
 *
 * <p>Several numeric fields are disabled rather than hidden when their switch
 * is off. That is load-bearing: a disabled input is not submitted, and the
 * passthrough hidden fields on the other tabs are what the action reads
 * instead. Removing a `disabled` here would change what gets saved.
 */

type PayCodeOption = { id: string; code: string; label: string };
interface Props { rules: HolidayRule[]; payCodes?: PayCodeOption[] }

const CREDIT_METHOD_LABELS: Record<string, string> = {
  FIXED_HOURS:     "Fixed Hours",
  ACTUAL_WORKED:   "Actual Worked",
  SCHEDULED_HOURS: "Scheduled Hours",
};

type View = "all" | "active" | "inactive";

const VIEWS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const YES_NO = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

function formatCredit(rule: HolidayRule): string {
  if (rule.creditMethod === "FIXED_HOURS") {
    const h = rule.creditMinutes / 60;
    return `Fixed ${Number.isInteger(h) ? h : h.toFixed(1)}h`;
  }
  return CREDIT_METHOD_LABELS[rule.creditMethod] ?? rule.creditMethod;
}

/** What a rule demands of the employee, in the words the editor uses. */
function formatEligibility(rule: HolidayRule): string | null {
  const parts = [
    rule.requireDayBefore && "day before",
    rule.requireDayAfter && "day after",
    rule.requireDayBeforeOrAfter && "day before or after",
    rule.mustNotWorkOnHoliday && "must not work the day",
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(" · ") : null;
}

type HolidayRuleTab = "general" | "holiday" | "prorate";

interface AssignedHoliday { id: string; name: string; date: string | Date }
interface OverrideRow { date: string; hours: string; payCodeId: string }

/**
 * A control sized to sit inside a sentence.
 *
 * <p>The kit's Input is a 32px labelled field; six of them on one line would
 * break the clause they belong to. This is the design system's 24px field with
 * its border, hover and focus ring, sized by the caller.
 */
function InlineInput({ width = 64, ...rest }: InputHTMLAttributes<HTMLInputElement> & { width?: number }) {
  return (
    <input
      {...rest}
      className="ta-field rounded px-2 py-1 disabled:opacity-40"
      style={{
        width,
        border: "1px solid var(--stroke-secondary)",
        background: "var(--surface-card)",
        color: "var(--text-primary)",
        font: "var(--type-body2)",
        fontVariantNumeric: "tabular-nums",
        textAlign: rest.type === "number" ? "right" : "left",
        outline: "none",
      }}
    />
  );
}

/** The select half of the same pair. */
function InlineSelect({ children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <Select {...rest} style={{ height: 26, font: "var(--type-body2)", padding: "0 6px" }}>
      {children}
    </Select>
  );
}

/** A labelled Select, matching the kit Input's label. */
function SelectField({
  label,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      <Select {...rest}>{children}</Select>
    </label>
  );
}

/**
 * One clause of a rule: a checkbox, the words that switch on with it, and any
 * fields the clause carries.
 *
 * <p>`label` goes inside the checkbox so clicking the words toggles it — on a
 * form of thirty switches, a label that is not a hit target is thirty small
 * misses. Anything in `children` sits beside it, because a select inside a
 * label toggles the checkbox every time you open it.
 */
function Clause({
  checked,
  onChange,
  label,
  children,
  indent = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  children?: ReactNode;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${indent ? "pl-6" : ""}`}
      style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
    >
      <Checkbox checked={checked} onChange={onChange} label={label} />
      {children}
    </div>
  );
}

function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between pb-1.5 text-left"
        style={{ border: "none", borderBottom: "1px solid var(--stroke-divider)", background: "transparent", cursor: "pointer" }}
      >
        <span className="wms-overline">{title}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${open ? "" : "-rotate-90"}`}
          style={{ color: "var(--icon-tertiary)" }}
        />
      </button>
      <div className={open ? "mt-3" : "hidden"}>{children}</div>
    </div>
  );
}

function HolidayRuleFields({ rule, isEdit, payCodes = [] }: { rule?: HolidayRule & { assignedHolidays?: { holiday: AssignedHoliday }[] }; isEdit?: boolean; payCodes?: PayCodeOption[] }) {
  const [tab, setTab] = useState<HolidayRuleTab>("general");
  const [creditMethod, setCreditMethod] = useState<string>(rule?.creditMethod ?? "FIXED_HOURS");
  const [tenureEnabled, setTenureEnabled] = useState(rule?.tenureRequiredEnabled ?? false);
  const [avgOnly, setAvgOnly] = useState(rule?.dailyWeeklyAveragingOnly ?? false);
  const [includeOnProbation, setIncludeOnProbation] = useState(rule?.includeOnProbation ?? false);

  // Holiday tab state
  const [birthdayIsHoliday, setBirthdayIsHoliday] = useState(rule?.birthdayIsHoliday ?? false);
  const [holidayOverridesEnabled, setHolidayOverridesEnabled] = useState(rule?.holidayOverridesEnabled ?? false);
  const existingOverrides = Array.isArray(rule?.holidayOverrides) ? rule.holidayOverrides as unknown as OverrideRow[] : [];
  const [numOverrides, setNumOverrides] = useState(existingOverrides.length || 3);
  const [overrides, setOverrides] = useState<OverrideRow[]>(() => {
    const base = existingOverrides.length
      ? existingOverrides.map((o) => ({ date: o.date ?? "", hours: String(o.hours ?? "0.000"), payCodeId: o.payCodeId ?? "" }))
      : [];
    while (base.length < 3) base.push({ date: "", hours: "0.000", payCodeId: "" });
    return base;
  });

  function setNumOverridesAndResize(n: number) {
    setNumOverrides(n);
    setOverrides((prev) => {
      const next = [...prev];
      while (next.length < n) next.push({ date: "", hours: "0.000", payCodeId: "" });
      return next;
    });
  }

  // Prorate rule state
  const [prorateEnabled, setProrateEnabled] = useState(rule?.prorateEnabled ?? false);
  const [prorateUseCustomRange, setProrateUseCustomRange] = useState(rule?.prorateUseCustomRange ?? false);
  const [prorateAppliedRule, setProrateAppliedRule] = useState(rule?.prorateAppliedRule ?? "AVERAGE_DAILY");
  const [prorateExcludeOt, setProrateExcludeOt] = useState(rule?.prorateExcludeOt ?? false);

  // Other rules state
  const [payNonWorkingHolidayOnly, setPayNonWorkingHolidayOnly] = useState(rule?.payNonWorkingHolidayOnly ?? false);
  const [postWorkingHoursToAccrual, setPostWorkingHoursToAccrual] = useState(rule?.postWorkingHoursToAccrual ?? false);
  const [postWorkingHoursExcessEnabled, setPostWorkingHoursExcessEnabled] = useState(rule?.postWorkingHoursExcessEnabled ?? false);
  const [includeNonCalcAttendance, setIncludeNonCalcAttendance] = useState(rule?.includeNonCalcAttendance ?? true);

  // Eligibility rules state
  const [requireDayBefore, setRequireDayBefore] = useState(rule?.requireDayBefore ?? false);
  const [requireDayAfter, setRequireDayAfter] = useState(rule?.requireDayAfter ?? false);
  const [requireDayBeforeOrAfter, setRequireDayBeforeOrAfter] = useState(rule?.requireDayBeforeOrAfter ?? false);
  const [requireDaysWorkedEnabled, setRequireDaysWorkedEnabled] = useState(rule?.requireDaysWorkedEnabled ?? false);
  const [requireScheduledHoursPct, setRequireScheduledHoursPct] = useState(rule?.requireScheduledHoursPct ?? false);
  const [mustNotWorkOnHoliday, setMustNotWorkOnHoliday] = useState(rule?.mustNotWorkOnHoliday ?? false);
  const [useDynamicSchedules, setUseDynamicSchedules] = useState(rule?.useDynamicSchedules ?? false);
  const [bypassAfterEligibility, setBypassAfterEligibility] = useState(rule?.bypassAfterEligibility ?? false);
  const [excludedWeekDays, setExcludedWeekDays] = useState<number[]>(rule?.excludedWeekDays ?? []);

  const tabs: { key: HolidayRuleTab; label: string }[] = [
    { key: "general", label: "General" },
    { key: "holiday", label: "Holiday" },
    { key: "prorate", label: "Prorate Rule" },
  ];

  return (
    <div>
      {/* Tab bar. The design system has no underline tab: a set this small
          and this mutually exclusive is a segmented control. */}
      <div className="mb-4">
        <SegmentedControl
          items={tabs.map((t) => ({ value: t.key, label: t.label }))}
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
        />
      </div>

      {/* ── General tab ── */}
      <div className={tab !== "general" ? "hidden" : "flex flex-col gap-5"}>

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(160px,24%)),1fr))]">
          <Input label="Rule Number" name="number" type="number" min="1" max="99999" defaultValue={rule?.number ?? ""} placeholder="e.g. 10" />
          <Input label="Rule Name" name="name" required defaultValue={rule?.name ?? ""} placeholder="e.g. Standard Holiday" />
          {isEdit && (
            <SelectField label="Status" name="isActive" defaultValue={rule?.isActive ? "true" : "false"}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </SelectField>
          )}
        </div>

        <CollapsibleSection title="Holiday Pay Hours">
          <div className="flex flex-col gap-3">

            <Clause
              checked={creditMethod === "SCHEDULED_HOURS"}
              onChange={(on) => setCreditMethod(on ? "SCHEDULED_HOURS" : "FIXED_HOURS")}
              label="Use scheduled hours as holiday pay hours"
            />
            <input type="hidden" name="creditMethod" value={creditMethod} />

            <div
              className="flex flex-wrap items-center gap-3"
              style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
            >
              <span>Use a Fixed number of Pay Hours:</span>
              {/* Disabled, not hidden: a disabled field is not submitted, and
                  the Holiday tab's passthrough copy of creditHours is what the
                  action then reads. */}
              <InlineInput
                name="creditHours"
                type="number" step="0.25" min="0" max="24"
                defaultValue={rule ? rule.creditMinutes / 60 : 8}
                disabled={creditMethod === "SCHEDULED_HOURS"}
                width={88}
              />
              <span style={{ color: "var(--text-tertiary)" }}>Maximum:</span>
              <InlineInput
                name="maxCreditHours"
                type="number" step="0.25" min="0" max="24"
                defaultValue={rule ? rule.maxCreditMinutes / 60 : 0}
                width={88}
              />
              <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>(0 = no cap)</span>
            </div>

            <div
              className="flex flex-wrap items-center gap-3"
              style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
            >
              <span>Pay Code:</span>
              <InlineSelect name="payCodeId" defaultValue={rule?.payCodeId ?? ""}>
                <option value="">— None —</option>
                {payCodes.map((pc) => (
                  <option key={pc.id} value={pc.id}>{pc.code}{pc.label ? ` — ${pc.label}` : ""}</option>
                ))}
              </InlineSelect>
            </div>

            <Clause checked={includeOnProbation} onChange={setIncludeOnProbation} label="Include employees on probation" />
            <input type="hidden" name="includeOnProbation" value={includeOnProbation ? "true" : "false"} />

            <div>
              <Clause checked={tenureEnabled} onChange={setTenureEnabled} label="Employee">
                <InlineSelect name="tenureRequiredBasis" defaultValue={rule?.tenureRequiredBasis ?? "HIRE_DATE"}>
                  <option value="HIRE_DATE">Hire Date</option>
                  <option value="ADJUSTED_HIRE_DATE">Adjusted Hire Date</option>
                </InlineSelect>
                <span>must be at least</span>
                <InlineInput
                  name="tenureRequiredDays" type="number" min="0"
                  defaultValue={rule?.tenureRequiredDays ?? 90}
                  disabled={!tenureEnabled}
                />
                <InlineSelect name="tenureRequiredUnit" defaultValue={rule?.tenureRequiredUnit ?? "DAYS"}>
                  <option value="DAYS">Days</option>
                  <option value="MONTHS">Months</option>
                </InlineSelect>
                <span>before the holiday</span>
              </Clause>
              <input type="hidden" name="tenureRequiredEnabled" value={tenureEnabled ? "true" : "false"} />
            </div>

            <div>
              <Clause
                checked={avgOnly}
                onChange={setAvgOnly}
                indent
                label="Only include employees currently assigned to and active with Daily/Weekly Averaging"
              />
              <input type="hidden" name="dailyWeeklyAveragingOnly" value={avgOnly ? "true" : "false"} />
            </div>

          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Eligibility Rules">
          <div className="flex flex-col gap-2.5">
            <p style={{ margin: 0, font: "var(--type-caption1)", fontStyle: "italic", color: "var(--text-tertiary)", textWrap: "pretty" }}>
              All calculated pay codes and all non-calculated pay codes configured to count as attendance count that day as a work day.
            </p>

            <Clause checked={requireDayBefore} onChange={setRequireDayBefore} label="Must work the scheduled day before holiday" />
            <input type="hidden" name="requireDayBefore" value={requireDayBefore ? "true" : "false"} />

            <Clause checked={requireDayAfter} onChange={setRequireDayAfter} label="Must work the scheduled day after holiday" />
            <input type="hidden" name="requireDayAfter" value={requireDayAfter ? "true" : "false"} />

            <Clause
              checked={requireDayBeforeOrAfter}
              onChange={setRequireDayBeforeOrAfter}
              label="Must work the scheduled day before OR scheduled day after a holiday"
            />
            <input type="hidden" name="requireDayBeforeOrAfter" value={requireDayBeforeOrAfter ? "true" : "false"} />

            <div>
              <Clause checked={requireDaysWorkedEnabled} onChange={setRequireDaysWorkedEnabled} label="Must work at least">
                <InlineInput
                  name="requireDaysWorkedCount" type="number" min="0" max="365"
                  defaultValue={rule?.requireDaysWorkedCount ?? 0}
                  disabled={!requireDaysWorkedEnabled}
                />
                <span>days within the last</span>
                <InlineInput
                  name="requireDaysWorkedPeriod" type="number" min="0" max="365"
                  defaultValue={rule?.requireDaysWorkedPeriod ?? 0}
                  disabled={!requireDaysWorkedEnabled}
                />
                <InlineSelect
                  name="requireDaysWorkedPeriodUnit"
                  defaultValue={rule?.requireDaysWorkedPeriodUnit ?? "DAY"}
                  disabled={!requireDaysWorkedEnabled}
                >
                  <option value="DAY">Day</option>
                  <option value="WEEK">Week</option>
                </InlineSelect>
                <span>period before the holiday</span>
              </Clause>
              <input type="hidden" name="requireDaysWorkedEnabled" value={requireDaysWorkedEnabled ? "true" : "false"} />
              {requireDaysWorkedEnabled && (
                <div
                  className="mt-1.5 flex flex-wrap items-center gap-2 pl-6"
                  style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                >
                  <span>Minimum required daily hours to count as a work day:</span>
                  <InlineInput
                    name="requireDaysWorkedMinDailyHours" type="number" step="0.25" min="0"
                    defaultValue={Number(rule?.requireDaysWorkedMinDailyHours ?? 0)}
                    width={80}
                  />
                </div>
              )}
            </div>

            <div>
              <Clause checked={requireScheduledHoursPct} onChange={setRequireScheduledHoursPct} label="Must work at least">
                <InlineInput
                  name="requireScheduledHoursPctValue" type="number" min="0" max="100"
                  defaultValue={rule?.requireScheduledHoursPctValue ?? 50}
                  disabled={!requireScheduledHoursPct}
                />
                <span>% of scheduled calculated pay code hours on eligible workday(s)</span>
              </Clause>
              <input type="hidden" name="requireScheduledHoursPct" value={requireScheduledHoursPct ? "true" : "false"} />
            </div>

            <Clause checked={mustNotWorkOnHoliday} onChange={setMustNotWorkOnHoliday} label="Must NOT work on the holiday" />
            <input type="hidden" name="mustNotWorkOnHoliday" value={mustNotWorkOnHoliday ? "true" : "false"} />

            <Clause
              checked={useDynamicSchedules}
              onChange={setUseDynamicSchedules}
              label="Look at all dynamic schedules for the day when determining eligibility rules (multiple in a day)"
            />
            <input type="hidden" name="useDynamicSchedules" value={useDynamicSchedules ? "true" : "false"} />

            <div>
              <p className="wms-label mb-1.5">Days of week Excluded from Eligibility:</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                  <Checkbox
                    key={day}
                    checked={excludedWeekDays.includes(i)}
                    onChange={(on) =>
                      setExcludedWeekDays((prev) =>
                        on ? [...prev, i].sort((a, b) => a - b) : prev.filter((d) => d !== i)
                      )
                    }
                    label={day}
                  />
                ))}
              </div>
              <input type="hidden" name="excludedWeekDays" value={excludedWeekDays.join(",")} />
            </div>

            <Clause
              checked={bypassAfterEligibility}
              onChange={setBypassAfterEligibility}
              label={
                <span style={{ textWrap: "pretty" }}>
                  Enable the bypass of scheduled workday &ldquo;after&rdquo; eligibility for select holidays
                  <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                    {" "}(Post Holiday bypass option also requires activation in Holidays setup)
                  </span>
                </span>
              }
            />
            <input type="hidden" name="bypassAfterEligibility" value={bypassAfterEligibility ? "true" : "false"} />

            <div
              className="flex flex-wrap items-center gap-3 pt-1"
              style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
            >
              <span>
                Minimum period hours to qualify{" "}
                <span style={{ color: "var(--text-tertiary)" }}>(0 = none):</span>
              </span>
              <InlineInput
                name="minPeriodHours" type="number" step="0.5" min="0"
                defaultValue={rule ? rule.minPeriodMinutes / 60 : 0}
                width={80}
              />
            </div>

          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Other Rules">
          <div className="flex flex-col gap-2.5">

            <Clause checked={payNonWorkingHolidayOnly} onChange={setPayNonWorkingHolidayOnly} label="Pay Non Working Holiday Hours Only" />
            <input type="hidden" name="payNonWorkingHolidayOnly" value={payNonWorkingHolidayOnly ? "true" : "false"} />

            <div>
              <Clause checked={postWorkingHoursToAccrual} onChange={setPostWorkingHoursToAccrual} label="Post Working Hours to Accrual">
                <span style={{ color: "var(--text-tertiary)" }}>Up to</span>
                <InlineInput
                  name="postWorkingHoursMax" type="number" step="0.25" min="0"
                  defaultValue={Number(rule?.postWorkingHoursMax ?? 0)}
                  disabled={!postWorkingHoursToAccrual}
                  width={80}
                />
                <span style={{ color: "var(--text-tertiary)" }}>Hours</span>
              </Clause>
              <input type="hidden" name="postWorkingHoursToAccrual" value={postWorkingHoursToAccrual ? "true" : "false"} />

              {postWorkingHoursToAccrual && (
                <div className="mt-1.5 flex flex-col gap-2 pl-6">
                  <Clause checked={postWorkingHoursExcessEnabled} onChange={setPostWorkingHoursExcessEnabled} label="Only post hours in excess of">
                    <InlineInput
                      name="postWorkingHoursExcessMin" type="number" step="0.25" min="0"
                      defaultValue={Number(rule?.postWorkingHoursExcessMin ?? 0)}
                      disabled={!postWorkingHoursExcessEnabled}
                      width={80}
                    />
                    <span style={{ color: "var(--text-tertiary)" }}>Hours</span>
                  </Clause>
                  <input type="hidden" name="postWorkingHoursExcessEnabled" value={postWorkingHoursExcessEnabled ? "true" : "false"} />

                  <div
                    className="flex flex-wrap items-center gap-2"
                    style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
                  >
                    <span>Accrual Code:</span>
                    <InlineInput name="accrualCode" type="text" placeholder="e.g. VAC" defaultValue={rule?.accrualCode ?? ""} width={160} />
                  </div>
                </div>
              )}
            </div>

            <Clause checked={includeNonCalcAttendance} onChange={setIncludeNonCalcAttendance} label="Include Non-Calculated Attendance Paycodes" />
            <input type="hidden" name="includeNonCalcAttendance" value={includeNonCalcAttendance ? "true" : "false"} />

          </div>
        </CollapsibleSection>

        {/* Hidden — fields removed from UI; preserve existing DB values */}
        <input type="hidden" name="payBucket" value={rule?.payBucket ?? "HOLIDAY"} />
        <input type="hidden" name="workingPremium" value={rule ? (rule.workingPremium / 100).toFixed(2) : "1.00"} />
        <input type="hidden" name="countTowardOt" value={rule?.countTowardOt !== false ? "true" : "false"} />

      </div>

      {/* ── Holiday tab ── */}
      <div className={tab !== "holiday" ? "hidden" : "flex flex-col gap-5"}>

        <div>
          <p className="wms-overline mb-2">Assigned Holidays</p>
          {(rule?.assignedHolidays ?? []).length === 0 ? (
            <p style={{ margin: 0, font: "var(--type-body1)", fontStyle: "italic", color: "var(--text-tertiary)" }}>
              No holidays assigned. Assign holidays from the Holidays page.
            </p>
          ) : (
            <div
              className="max-h-52 overflow-y-auto rounded-lg"
              style={{ border: "1px solid var(--stroke-secondary)" }}
            >
              {(rule?.assignedHolidays ?? []).map(({ holiday: h }) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 px-3 py-1.5"
                  style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                >
                  <span
                    className="tabular"
                    style={{ font: "var(--type-body2)", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}
                  >
                    {new Date(h.date).toLocaleDateString("en-US", { timeZone: "UTC", month: "2-digit", day: "2-digit", year: "numeric" })}
                  </span>
                  <span style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>{h.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <CollapsibleSection title="Holiday Overrides">
          <div className="flex flex-col gap-3">

            <div className="flex flex-wrap items-center gap-3">
              <span style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>Apply Holiday Overrides?</span>
              <SegmentedControl
                items={YES_NO}
                value={holidayOverridesEnabled ? "true" : "false"}
                onChange={(v) => setHolidayOverridesEnabled(v === "true")}
                size="sm"
                ariaLabel="Apply holiday overrides"
              />
            </div>
            <input type="hidden" name="holidayOverridesEnabled" value={holidayOverridesEnabled ? "true" : "false"} />

            {holidayOverridesEnabled && (
              <>
                <div className="flex flex-wrap items-center gap-3" style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                  <span>Number of overrides:</span>
                  <InlineSelect
                    aria-label="Number of overrides"
                    value={numOverrides}
                    onChange={(e) => setNumOverridesAndResize(Number(e.target.value))}
                  >
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </InlineSelect>
                </div>

                <div className="flex flex-col gap-2">
                  {overrides.slice(0, numOverrides).map((o, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-2"
                      style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                    >
                      <span className="w-20">Override {i + 1}:</span>
                      <InlineInput
                        type="date"
                        aria-label={`Override ${i + 1} date`}
                        value={o.date}
                        onChange={(e) => setOverrides((prev) => prev.map((r, j) => j === i ? { ...r, date: e.target.value } : r))}
                        width={140}
                      />
                      <span>Hours:</span>
                      <InlineInput
                        type="number" step="0.001" min="0"
                        aria-label={`Override ${i + 1} hours`}
                        value={o.hours}
                        onChange={(e) => setOverrides((prev) => prev.map((r, j) => j === i ? { ...r, hours: e.target.value } : r))}
                        width={88}
                      />
                      <span>Pay Code:</span>
                      <InlineSelect
                        aria-label={`Override ${i + 1} pay code`}
                        value={o.payCodeId}
                        onChange={(e) => setOverrides((prev) => prev.map((r, j) => j === i ? { ...r, payCodeId: e.target.value } : r))}
                      >
                        <option value="">— Select —</option>
                        {payCodes.map((pc) => (
                          <option key={pc.id} value={pc.id}>{pc.code}{pc.label ? ` — ${pc.label}` : ""}</option>
                        ))}
                      </InlineSelect>
                    </div>
                  ))}
                </div>
              </>
            )}
            <input type="hidden" name="holidayOverrides" value={JSON.stringify(overrides.slice(0, numOverrides))} />

          </div>
        </CollapsibleSection>

        <Clause checked={birthdayIsHoliday} onChange={setBirthdayIsHoliday} label="Employee Birthdays are considered a Holiday" />
        <input type="hidden" name="birthdayIsHoliday" value={birthdayIsHoliday ? "true" : "false"} />

        {/* Passthrough fields not on this tab */}
        <input type="hidden" name="creditMethod" value={creditMethod} />
        <input type="hidden" name="creditHours" value={rule ? rule.creditMinutes / 60 : 8} />
        <input type="hidden" name="maxCreditHours" value={rule ? rule.maxCreditMinutes / 60 : 0} />
        <input type="hidden" name="payBucket" value={rule?.payBucket ?? "HOLIDAY"} />
        <input type="hidden" name="workingPremium" value={rule ? (rule.workingPremium / 100).toFixed(2) : "1.00"} />
        <input type="hidden" name="countTowardOt" value={rule?.countTowardOt !== false ? "true" : "false"} />

      </div>

      {/* ── Prorate Rule tab ── */}
      <div className={tab !== "prorate" ? "hidden" : "flex flex-col gap-5"}>

        <div className="flex flex-col gap-2">
          <p className="wms-overline">Apply Holiday Prorate Rule?</p>
          <span className="self-start">
            <SegmentedControl
              items={YES_NO}
              value={prorateEnabled ? "true" : "false"}
              onChange={(v) => setProrateEnabled(v === "true")}
              size="sm"
              ariaLabel="Apply holiday prorate rule"
            />
          </span>
          <input type="hidden" name="prorateEnabled" value={prorateEnabled ? "true" : "false"} />
        </div>

        {prorateEnabled && (
          <>
            <CollapsibleSection title="Day Range" defaultOpen={true}>
              <div className="flex flex-col gap-3">

                <label
                  className="flex cursor-pointer flex-wrap items-center gap-2"
                  style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
                >
                  <input
                    type="radio"
                    checked={!prorateUseCustomRange}
                    onChange={() => setProrateUseCustomRange(false)}
                    className="accent-[var(--fill-accent)]"
                  />
                  <span>Look Back</span>
                  <InlineInput
                    name="prorateLookbackDays" type="number" min="1" max="365"
                    defaultValue={rule?.prorateLookbackDays ?? 28}
                  />
                  <span>days</span>
                  <InlineSelect
                    name="prorateIncludeCurrentWeek"
                    defaultValue={rule?.prorateIncludeCurrentWeek !== false ? "true" : "false"}
                  >
                    <option value="true">include current week</option>
                    <option value="false">exclude current week</option>
                  </InlineSelect>
                  <span>to determine total worked hours</span>
                </label>

                <label
                  className="flex cursor-pointer items-center gap-2"
                  style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
                >
                  <input
                    type="radio"
                    checked={prorateUseCustomRange}
                    onChange={() => setProrateUseCustomRange(true)}
                    className="accent-[var(--fill-accent)]"
                  />
                  Custom day range to determine total worked hours
                </label>
                <input type="hidden" name="prorateUseCustomRange" value={prorateUseCustomRange ? "true" : "false"} />

              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Applied Rule" defaultOpen={true}>
              <div className="flex flex-col gap-4">

                <label
                  className="flex cursor-pointer items-start gap-2"
                  style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
                >
                  <input
                    type="radio"
                    checked={prorateAppliedRule === "THRESHOLD"}
                    onChange={() => setProrateAppliedRule("THRESHOLD")}
                    className="mt-1 accent-[var(--fill-accent)]"
                  />
                  <span className="flex flex-col gap-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span>Worked hours are greater or equal</span>
                      <InlineInput
                        name="prorateThresholdHours" type="number" step="0.001" min="0"
                        defaultValue={Number(rule?.prorateThresholdHours ?? 0).toFixed(3)}
                        disabled={prorateAppliedRule !== "THRESHOLD"}
                        width={88}
                      />
                      <span>hours, then employee will get the full amount holiday pay,</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span style={{ color: "var(--text-tertiary)" }}>otherwise prorate total worked hours by multiplying by</span>
                      <InlineInput
                        name="prorateMultiplier" type="number" step="0.0000001" min="0"
                        defaultValue={Number(rule?.prorateMultiplier ?? 0).toFixed(7)}
                        disabled={prorateAppliedRule !== "THRESHOLD"}
                        width={128}
                      />
                    </span>
                  </span>
                </label>

                <label
                  className="flex cursor-pointer flex-wrap items-center gap-2"
                  style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
                >
                  <input
                    type="radio"
                    checked={prorateAppliedRule === "AVERAGE_DAILY"}
                    onChange={() => setProrateAppliedRule("AVERAGE_DAILY")}
                    className="accent-[var(--fill-accent)]"
                  />
                  <span>Pay Average daily worked hours up to</span>
                  <InlineInput
                    name="prorateAverageDailyMaxHours" type="number" step="0.001" min="0" max="24"
                    defaultValue={Number(rule?.prorateAverageDailyMaxHours ?? 8).toFixed(3)}
                    disabled={prorateAppliedRule !== "AVERAGE_DAILY"}
                    width={88}
                  />
                </label>
                <input type="hidden" name="prorateAppliedRule" value={prorateAppliedRule} />

              </div>
            </CollapsibleSection>

            <Clause checked={prorateExcludeOt} onChange={setProrateExcludeOt} label="Exclude Overtime when calculating Work hours" />
            <input type="hidden" name="prorateExcludeOt" value={prorateExcludeOt ? "true" : "false"} />
          </>
        )}

        {/* Always submit prorate fields so they're not lost when prorateEnabled=false */}
        {!prorateEnabled && (
          <>
            <input type="hidden" name="prorateUseCustomRange" value="false" />
            <input type="hidden" name="prorateAppliedRule" value={prorateAppliedRule} />
          </>
        )}

      </div>

    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ta-modal max-h-[90vh] w-full max-w-3xl overflow-y-auto"
        style={{ borderRadius: "var(--radius-l)" }}
      >
        <header
          className="flex items-center justify-between gap-3 px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <h3 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>{title}</h3>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function HolidayRulesManager({ rules, payCodes = [] }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<HolidayRule | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [view, setView] = useState<View>("active");
  const [search, setSearch] = useState("");

  const searchLower = search.trim().toLowerCase();
  const visible = rules
    .filter((r) => (view === "all" ? true : view === "active" ? r.isActive : !r.isActive))
    .filter((r) => !searchLower || r.name.toLowerCase().includes(searchLower));

  function openEdit(rule: HolidayRule) { setEditingRule(rule); setConfirmDeleteId(null); setError(null); }
  function closeEdit() { setEditingRule(null); setConfirmDeleteId(null); setError(null); }
  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  function buildPayload(fd: FormData) {
    const numStr = fd.get("number") as string;
    return {
      number:                         numStr ? Number(numStr) : null,
      name:                           fd.get("name") as string,
      creditMethod:                   fd.get("creditMethod") as string,
      creditHours:                    Number(fd.get("creditHours") ?? 8),
      maxCreditHours:                 Number(fd.get("maxCreditHours") ?? 0),
      payBucket:                      fd.get("payBucket") as string,
      payCodeId:                      (fd.get("payCodeId") as string) || null,
      workingPremium:                 Number(fd.get("workingPremium") ?? 1.0),
      includeOnProbation:             fd.get("includeOnProbation") === "true",
      tenureRequiredEnabled:          fd.get("tenureRequiredEnabled") === "true",
      tenureRequiredDays:             Number(fd.get("tenureRequiredDays") ?? 90),
      tenureRequiredBasis:            (fd.get("tenureRequiredBasis") as string) || "HIRE_DATE",
      tenureRequiredUnit:             (fd.get("tenureRequiredUnit") as string) || "DAYS",
      dailyWeeklyAveragingOnly:       fd.get("dailyWeeklyAveragingOnly") === "true",
      requireDayBefore:               fd.get("requireDayBefore") === "true",
      requireDayAfter:                fd.get("requireDayAfter") === "true",
      requireDayBeforeOrAfter:        fd.get("requireDayBeforeOrAfter") === "true",
      minPeriodHours:                 Number(fd.get("minPeriodHours") ?? 0),
      requireDaysWorkedEnabled:       fd.get("requireDaysWorkedEnabled") === "true",
      requireDaysWorkedCount:         Number(fd.get("requireDaysWorkedCount") ?? 0),
      requireDaysWorkedPeriod:        Number(fd.get("requireDaysWorkedPeriod") ?? 0),
      requireDaysWorkedPeriodUnit:    (fd.get("requireDaysWorkedPeriodUnit") as string) || "DAY",
      requireDaysWorkedMinDailyHours: Number(fd.get("requireDaysWorkedMinDailyHours") ?? 0),
      requireScheduledHoursPct:       fd.get("requireScheduledHoursPct") === "true",
      requireScheduledHoursPctValue:  Number(fd.get("requireScheduledHoursPctValue") ?? 50),
      mustNotWorkOnHoliday:           fd.get("mustNotWorkOnHoliday") === "true",
      useDynamicSchedules:            fd.get("useDynamicSchedules") === "true",
      excludedWeekDays:               (fd.get("excludedWeekDays") as string) || "",
      bypassAfterEligibility:         fd.get("bypassAfterEligibility") === "true",
      payNonWorkingHolidayOnly:       fd.get("payNonWorkingHolidayOnly") === "true",
      postWorkingHoursToAccrual:      fd.get("postWorkingHoursToAccrual") === "true",
      postWorkingHoursMax:            Number(fd.get("postWorkingHoursMax") ?? 0),
      postWorkingHoursExcessEnabled:  fd.get("postWorkingHoursExcessEnabled") === "true",
      postWorkingHoursExcessMin:      Number(fd.get("postWorkingHoursExcessMin") ?? 0),
      accrualCode:                    (fd.get("accrualCode") as string) || null,
      includeNonCalcAttendance:       fd.get("includeNonCalcAttendance") === "true",
      countTowardOt:                  fd.get("countTowardOt") as string,
      prorateEnabled:                 fd.get("prorateEnabled") === "true",
      prorateLookbackDays:            Number(fd.get("prorateLookbackDays") ?? 28),
      prorateIncludeCurrentWeek:      fd.get("prorateIncludeCurrentWeek") !== "false",
      prorateUseCustomRange:          fd.get("prorateUseCustomRange") === "true",
      prorateAppliedRule:             (fd.get("prorateAppliedRule") as string) || "AVERAGE_DAILY",
      prorateThresholdHours:          Number(fd.get("prorateThresholdHours") ?? 0),
      prorateMultiplier:              Number(fd.get("prorateMultiplier") ?? 0),
      prorateAverageDailyMaxHours:    Number(fd.get("prorateAverageDailyMaxHours") ?? 8),
      prorateExcludeOt:               fd.get("prorateExcludeOt") === "true",
      birthdayIsHoliday:              fd.get("birthdayIsHoliday") === "true",
      holidayOverridesEnabled:        fd.get("holidayOverridesEnabled") === "true",
      holidayOverrides:               (() => { try { return JSON.parse(fd.get("holidayOverrides") as string || "[]"); } catch { return []; } })(),
    };
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const payload = buildPayload(new FormData(e.currentTarget));
    setError(null);
    startTransition(async () => {
      const result = await createHolidayRule(payload);
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(rule: HolidayRule, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateHolidayRule({ ruleId: rule.id, isActive: fd.get("isActive") as string, ...buildPayload(fd) });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  function handleDelete(ruleId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteHolidayRule({ ruleId });
      if (!result.success) { setError(result.error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      closeEdit();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {error && !editingRule && !showCreate && <Banner tone="error" body={error} />}

      <Toolbar count={visible.length} countLabel="rule">
        <SegmentedControl
          items={VIEWS}
          value={view}
          onChange={(v) => setView(v as View)}
          size="sm"
          ariaLabel="Which holiday rules to show"
        />
        <SearchInput value={search} onValueChange={setSearch} placeholder="Search rules…" width={220} />
        <Button onClick={openCreate}>New Holiday Rule</Button>
      </Toolbar>

      <Card padding={0}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" />}
            title={searchLower ? `No rules match “${search}”` : view === "active" ? "No active holiday rules" : "No holiday rules"}
            body="A holiday rule decides who is paid for a holiday and how many hours they get."
            action={
              searchLower
                ? <Button size="sm" hierarchy="secondary" onClick={() => setSearch("")}>Clear search</Button>
                : <Button size="sm" onClick={openCreate}>New Holiday Rule</Button>
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH numeric style={{ width: 56 }}>#</TH>
                  <TH>Rule</TH>
                  <TH>Holiday Pay</TH>
                  <TH numeric>Working Premium</TH>
                  <TH>Must Work</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((rule) => {
                  const eligibility = formatEligibility(rule);
                  return (
                    <TR key={rule.id} onClick={() => openEdit(rule)}>
                      <TD numeric style={{ color: "var(--text-secondary)" }}>
                        {rule.number ?? <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                      </TD>
                      <TD style={{ fontWeight: "var(--weight-medium)" }}>{rule.name}</TD>
                      <TD style={{ color: "var(--text-secondary)" }}>{formatCredit(rule)}</TD>
                      <TD numeric style={{ color: "var(--text-secondary)" }}>
                        {(rule.workingPremium / 100).toFixed(2)}×
                      </TD>
                      <TD style={{ color: "var(--text-secondary)" }}>
                        {eligibility ?? <span style={{ color: "var(--text-tertiary)" }}>No condition</span>}
                      </TD>
                      <TD>
                        {rule.isActive ? (
                          <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                        ) : (
                          // statusTone would answer "warning"; a rule that is
                          // switched off is not something to go and fix.
                          <Badge size="sm">Inactive</Badge>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <TableFooter
              shown={visible.length}
              total={rules.length}
              label={rules.length === 1 ? "rule" : "rules"}
            />
          </>
        )}
      </Card>

      {showCreate && (
        <Modal title="New Holiday Rule" onClose={closeCreate}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={handleCreate}>
            <HolidayRuleFields payCodes={payCodes} />
            <div className="mt-5 flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
              <Button type="submit" disabled={isPending}>{isPending ? "Creating…" : "Create"}</Button>
              <Button type="button" hierarchy="secondary" onClick={closeCreate}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {editingRule && (
        <Modal title={`Edit: ${editingRule.name}`} onClose={closeEdit}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={(e) => handleUpdate(editingRule, e)}>
            <HolidayRuleFields rule={editingRule} isEdit payCodes={payCodes} />
            <div
              className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-4"
              style={{ borderTop: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex gap-2">
                <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save changes"}</Button>
                <Button type="button" hierarchy="secondary" onClick={closeEdit}>Cancel</Button>
              </div>
              {confirmDeleteId === editingRule.id ? (
                <div className="flex items-center gap-2">
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Are you sure?</span>
                  <Button type="button" tone="error" size="sm" onClick={() => handleDelete(editingRule.id)} disabled={isPending}>
                    {isPending ? "Deleting…" : "Yes, delete"}
                  </Button>
                  <Button type="button" hierarchy="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button type="button" hierarchy="link" tone="error" size="sm" onClick={() => setConfirmDeleteId(editingRule.id)}>
                  Delete rule
                </Button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
