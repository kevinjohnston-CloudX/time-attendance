"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createHolidayRule, updateHolidayRule, deleteHolidayRule } from "@/actions/holiday-rule.actions";
import type { HolidayRule } from "@prisma/client";

type PayCodeOption = { id: string; code: string; label: string };
interface Props { rules: HolidayRule[]; payCodes?: PayCodeOption[] }

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

const CREDIT_METHOD_LABELS: Record<string, string> = {
  FIXED_HOURS:     "Fixed Hours",
  ACTUAL_WORKED:   "Actual Worked",
  SCHEDULED_HOURS: "Scheduled Hours",
};

const PAY_BUCKET_OPTIONS = [
  { value: "HOLIDAY", label: "Holiday" },
  { value: "REG",     label: "Regular" },
  { value: "OT",      label: "Overtime" },
  { value: "DT",      label: "Double Time" },
];

function formatCredit(rule: HolidayRule): string {
  if (rule.creditMethod === "FIXED_HOURS") {
    const h = rule.creditMinutes / 60;
    return `Fixed ${Number.isInteger(h) ? h : h.toFixed(1)}h`;
  }
  return CREDIT_METHOD_LABELS[rule.creditMethod] ?? rule.creditMethod;
}

function formatPremium(rule: HolidayRule): string {
  return `${(rule.workingPremium / 100).toFixed(2)}× working premium`;
}

type HolidayRuleTab = "general" | "holiday" | "prorate";

interface AssignedHoliday { id: string; name: string; date: string | Date }
interface OverrideRow { date: string; hours: string; payCodeId: string }

function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between border-b border-zinc-100 pb-1.5 text-left dark:border-zinc-800"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-150 ${open ? "" : "-rotate-90"}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
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
      {/* Tab bar */}
      <div className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── General tab ── */}
      <div className={tab !== "general" ? "hidden" : "flex flex-col gap-5"}>

          {/* Number + Name + Status */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Rule Number</label>
              <input name="number" type="number" min="1" max="99999" defaultValue={rule?.number ?? ""} placeholder="e.g. 10" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-zinc-500">Rule Name</label>
              <input name="name" required defaultValue={rule?.name ?? ""} placeholder="e.g. Standard Holiday" className={inputCls} />
            </div>
            {isEdit && (
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Status</label>
                <select name="isActive" defaultValue={rule?.isActive ? "true" : "false"} className={inputCls}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            )}
          </div>

          <CollapsibleSection title="Holiday Pay Hours">
            <div className="flex flex-col gap-3">

              {/* Use scheduled hours checkbox */}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={creditMethod === "SCHEDULED_HOURS"}
                  onChange={(e) => setCreditMethod(e.target.checked ? "SCHEDULED_HOURS" : "FIXED_HOURS")}
                  className="rounded"
                />
                Use scheduled hours as holiday pay hours
              </label>
              <input type="hidden" name="creditMethod" value={creditMethod} />

              {/* Fixed hours + maximum row */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">Use a Fixed number of Pay Hours:</span>
                <input
                  name="creditHours"
                  type="number" step="0.25" min="0" max="24"
                  defaultValue={rule ? rule.creditMinutes / 60 : 8}
                  disabled={creditMethod === "SCHEDULED_HOURS"}
                  className={`w-24 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white text-right ${creditMethod === "SCHEDULED_HOURS" ? "opacity-40" : ""}`}
                />
                <span className="text-sm text-zinc-400">Maximum:</span>
                <input
                  name="maxCreditHours"
                  type="number" step="0.25" min="0" max="24"
                  defaultValue={rule ? rule.maxCreditMinutes / 60 : 0}
                  className="w-24 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white text-right"
                />
                <span className="text-xs text-zinc-400">(0 = no cap)</span>
              </div>

              {/* Pay Code */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">Pay Code:</span>
                <select name="payCodeId" defaultValue={rule?.payCodeId ?? ""} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">
                  <option value="">— None —</option>
                  {payCodes.map((pc) => (
                    <option key={pc.id} value={pc.id}>{pc.code}{pc.label ? ` — ${pc.label}` : ""}</option>
                  ))}
                </select>
              </div>

              {/* Include on probation */}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" name="includeOnProbation" value="true"
                  defaultChecked={rule?.includeOnProbation ?? false} className="rounded" />
                Include employees on probation
              </label>

              {/* Tenure requirement */}
              <div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" checked={tenureEnabled}
                    onChange={(e) => setTenureEnabled(e.target.checked)} className="rounded" />
                  <span>Employee</span>
                  <select name="tenureRequiredBasis" defaultValue={rule?.tenureRequiredBasis ?? "HIRE_DATE"}
                    className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">
                    <option value="HIRE_DATE">Hire Date</option>
                    <option value="ADJUSTED_HIRE_DATE">Adjusted Hire Date</option>
                  </select>
                  <span>must be at least</span>
                  <input name="tenureRequiredDays" type="number" min="0"
                    defaultValue={rule?.tenureRequiredDays ?? 90}
                    disabled={!tenureEnabled}
                    className={`w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${!tenureEnabled ? "opacity-40" : ""}`} />
                  <select name="tenureRequiredUnit" defaultValue={rule?.tenureRequiredUnit ?? "DAYS"}
                    className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">
                    <option value="DAYS">Days</option>
                    <option value="MONTHS">Months</option>
                  </select>
                  <span>before the holiday</span>
                </label>
                <input type="hidden" name="tenureRequiredEnabled" value={tenureEnabled ? "true" : "false"} />
              </div>

              {/* Daily/Weekly Averaging */}
              <div className="pl-6">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" checked={avgOnly}
                    onChange={(e) => setAvgOnly(e.target.checked)} className="rounded" />
                  Only include employees currently assigned to and active with Daily/Weekly Averaging
                </label>
                <input type="hidden" name="dailyWeeklyAveragingOnly" value={avgOnly ? "true" : "false"} />
              </div>

            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Eligibility Rules">
            <div className="flex flex-col gap-2.5">
              <p className="text-xs italic text-zinc-400">All calculated pay codes and all non-calculated pay codes configured to count as attendance count that day as a work day.</p>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={requireDayBefore} onChange={(e) => setRequireDayBefore(e.target.checked)} className="rounded" />
                Must work the scheduled day before holiday
              </label>
              <input type="hidden" name="requireDayBefore" value={requireDayBefore ? "true" : "false"} />

              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={requireDayAfter} onChange={(e) => setRequireDayAfter(e.target.checked)} className="rounded" />
                Must work the scheduled day after holiday
              </label>
              <input type="hidden" name="requireDayAfter" value={requireDayAfter ? "true" : "false"} />

              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={requireDayBeforeOrAfter} onChange={(e) => setRequireDayBeforeOrAfter(e.target.checked)} className="rounded" />
                Must work the scheduled day before OR scheduled day after a holiday
              </label>
              <input type="hidden" name="requireDayBeforeOrAfter" value={requireDayBeforeOrAfter ? "true" : "false"} />

              {/* Must work N days within N day/week period */}
              <div>
                <label className="flex flex-wrap cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" checked={requireDaysWorkedEnabled} onChange={(e) => setRequireDaysWorkedEnabled(e.target.checked)} className="rounded" />
                  <span>Must work at least</span>
                  <input name="requireDaysWorkedCount" type="number" min="0" max="365"
                    defaultValue={rule?.requireDaysWorkedCount ?? 0}
                    disabled={!requireDaysWorkedEnabled}
                    className={`w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${!requireDaysWorkedEnabled ? "opacity-40" : ""}`} />
                  <span>days within the last</span>
                  <input name="requireDaysWorkedPeriod" type="number" min="0" max="365"
                    defaultValue={rule?.requireDaysWorkedPeriod ?? 0}
                    disabled={!requireDaysWorkedEnabled}
                    className={`w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${!requireDaysWorkedEnabled ? "opacity-40" : ""}`} />
                  <select name="requireDaysWorkedPeriodUnit" defaultValue={rule?.requireDaysWorkedPeriodUnit ?? "DAY"}
                    disabled={!requireDaysWorkedEnabled}
                    className={`rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${!requireDaysWorkedEnabled ? "opacity-40" : ""}`}>
                    <option value="DAY">Day</option>
                    <option value="WEEK">Week</option>
                  </select>
                  <span>period before the holiday</span>
                </label>
                <input type="hidden" name="requireDaysWorkedEnabled" value={requireDaysWorkedEnabled ? "true" : "false"} />
                {requireDaysWorkedEnabled && (
                  <div className="mt-1.5 flex items-center gap-2 pl-6">
                    <span className="text-xs text-zinc-500">Minimum required daily hours to count as a work day:</span>
                    <input name="requireDaysWorkedMinDailyHours" type="number" step="0.25" min="0"
                      defaultValue={Number(rule?.requireDaysWorkedMinDailyHours ?? 0)}
                      className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                  </div>
                )}
              </div>

              {/* N% of scheduled hours */}
              <div>
                <label className="flex flex-wrap cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" checked={requireScheduledHoursPct} onChange={(e) => setRequireScheduledHoursPct(e.target.checked)} className="rounded" />
                  <span>Must work at least</span>
                  <input name="requireScheduledHoursPctValue" type="number" min="0" max="100"
                    defaultValue={rule?.requireScheduledHoursPctValue ?? 50}
                    disabled={!requireScheduledHoursPct}
                    className={`w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${!requireScheduledHoursPct ? "opacity-40" : ""}`} />
                  <span>% of scheduled calculated pay code hours on eligible workday(s)</span>
                </label>
                <input type="hidden" name="requireScheduledHoursPct" value={requireScheduledHoursPct ? "true" : "false"} />
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={mustNotWorkOnHoliday} onChange={(e) => setMustNotWorkOnHoliday(e.target.checked)} className="rounded" />
                Must NOT work on the holiday
              </label>
              <input type="hidden" name="mustNotWorkOnHoliday" value={mustNotWorkOnHoliday ? "true" : "false"} />

              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={useDynamicSchedules} onChange={(e) => setUseDynamicSchedules(e.target.checked)} className="rounded" />
                Look at all dynamic schedules for the day when determining eligibility rules (multiple in a day)
              </label>
              <input type="hidden" name="useDynamicSchedules" value={useDynamicSchedules ? "true" : "false"} />

              {/* Days of week excluded */}
              <div>
                <p className="mb-1.5 text-xs text-zinc-500">Days of week Excluded from Eligibility:</p>
                <div className="flex flex-wrap gap-3">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                    <label key={i} className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={excludedWeekDays.includes(i)}
                        onChange={(e) =>
                          setExcludedWeekDays((prev) =>
                            e.target.checked ? [...prev, i].sort((a, b) => a - b) : prev.filter((d) => d !== i)
                          )
                        }
                        className="rounded"
                      />
                      {day}
                    </label>
                  ))}
                </div>
                <input type="hidden" name="excludedWeekDays" value={excludedWeekDays.join(",")} />
              </div>

              <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={bypassAfterEligibility} onChange={(e) => setBypassAfterEligibility(e.target.checked)} className="mt-0.5 rounded" />
                <span>
                  Enable the bypass of scheduled workday &ldquo;after&rdquo; eligibility for select holidays
                  <span className="ml-1 text-xs text-zinc-400">(Post Holiday bypass option also requires activation in Holidays setup)</span>
                </span>
              </label>
              <input type="hidden" name="bypassAfterEligibility" value={bypassAfterEligibility ? "true" : "false"} />

              {/* Min period hours */}
              <div className="flex items-center gap-3 pt-1">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">Minimum period hours to qualify <span className="text-zinc-400">(0 = none):</span></span>
                <input name="minPeriodHours" type="number" step="0.5" min="0"
                  defaultValue={rule ? rule.minPeriodMinutes / 60 : 0}
                  className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
              </div>

            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Other Rules">
            <div className="flex flex-col gap-2.5">

              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={payNonWorkingHolidayOnly} onChange={(e) => setPayNonWorkingHolidayOnly(e.target.checked)} className="rounded" />
                Pay Non Working Holiday Hours Only
              </label>
              <input type="hidden" name="payNonWorkingHolidayOnly" value={payNonWorkingHolidayOnly ? "true" : "false"} />

              {/* Post Working Hours to Accrual */}
              <div>
                <label className="flex flex-wrap cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" checked={postWorkingHoursToAccrual} onChange={(e) => setPostWorkingHoursToAccrual(e.target.checked)} className="rounded" />
                  <span>Post Working Hours to Accrual</span>
                  <span className="text-zinc-400">Up to</span>
                  <input name="postWorkingHoursMax" type="number" step="0.25" min="0"
                    defaultValue={Number(rule?.postWorkingHoursMax ?? 0)}
                    disabled={!postWorkingHoursToAccrual}
                    className={`w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${!postWorkingHoursToAccrual ? "opacity-40" : ""}`} />
                  <span className="text-zinc-400">Hours</span>
                </label>
                <input type="hidden" name="postWorkingHoursToAccrual" value={postWorkingHoursToAccrual ? "true" : "false"} />

                {postWorkingHoursToAccrual && (
                  <div className="mt-1.5 pl-6 flex flex-col gap-2">
                    <label className="flex flex-wrap cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input type="checkbox" checked={postWorkingHoursExcessEnabled} onChange={(e) => setPostWorkingHoursExcessEnabled(e.target.checked)} className="rounded" />
                      <span>Only post hours in excess of</span>
                      <input name="postWorkingHoursExcessMin" type="number" step="0.25" min="0"
                        defaultValue={Number(rule?.postWorkingHoursExcessMin ?? 0)}
                        disabled={!postWorkingHoursExcessEnabled}
                        className={`w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${!postWorkingHoursExcessEnabled ? "opacity-40" : ""}`} />
                      <span className="text-zinc-400">Hours</span>
                    </label>
                    <input type="hidden" name="postWorkingHoursExcessEnabled" value={postWorkingHoursExcessEnabled ? "true" : "false"} />

                    <div className="flex items-center gap-2">
                      <label className="text-sm text-zinc-600 dark:text-zinc-400">Accrual Code:</label>
                      <input name="accrualCode" type="text" placeholder="e.g. VAC"
                        defaultValue={rule?.accrualCode ?? ""}
                        className="w-40 rounded border border-zinc-300 bg-white px-2 py-1 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                    </div>
                  </div>
                )}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={includeNonCalcAttendance} onChange={(e) => setIncludeNonCalcAttendance(e.target.checked)} className="rounded" />
                Include Non-Calculated Attendance Paycodes
              </label>
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

          {/* Assigned holidays — read-only */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Assigned Holidays</p>
            {(rule?.assignedHolidays ?? []).length === 0 ? (
              <p className="text-sm italic text-zinc-400">No holidays assigned. Assign holidays from the Holidays page.</p>
            ) : (
              <div className="max-h-52 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                {(rule?.assignedHolidays ?? []).map(({ holiday: h }) => (
                  <div key={h.id} className="flex items-center gap-3 border-b border-zinc-100 px-3 py-1.5 last:border-0 dark:border-zinc-800">
                    <span className="font-mono text-xs text-zinc-400">
                      {new Date(h.date).toLocaleDateString("en-US", { timeZone: "UTC", month: "2-digit", day: "2-digit", year: "numeric" })}
                    </span>
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">{h.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Holiday Overrides */}
          <CollapsibleSection title="Holiday Overrides">
            <div className="flex flex-col gap-3">

              <div className="flex items-center gap-6">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">Apply Holiday Overrides?</span>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="radio" checked={holidayOverridesEnabled} onChange={() => setHolidayOverridesEnabled(true)} className="accent-zinc-900 dark:accent-white" />
                  Yes
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="radio" checked={!holidayOverridesEnabled} onChange={() => setHolidayOverridesEnabled(false)} className="accent-zinc-900 dark:accent-white" />
                  No
                </label>
              </div>
              <input type="hidden" name="holidayOverridesEnabled" value={holidayOverridesEnabled ? "true" : "false"} />

              {holidayOverridesEnabled && (
                <>
                  <div className="flex items-center gap-3">
                    <label className="text-sm text-zinc-600 dark:text-zinc-400">Number of overrides:</label>
                    <select
                      value={numOverrides}
                      onChange={(e) => setNumOverridesAndResize(Number(e.target.value))}
                      className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-2">
                    {overrides.slice(0, numOverrides).map((o, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <span className="w-20 text-sm text-zinc-500">Override {i + 1}:</span>
                        <input
                          type="date"
                          value={o.date}
                          onChange={(e) => setOverrides((prev) => prev.map((r, j) => j === i ? { ...r, date: e.target.value } : r))}
                          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                        />
                        <span className="text-sm text-zinc-500">Hours:</span>
                        <input
                          type="number" step="0.001" min="0"
                          value={o.hours}
                          onChange={(e) => setOverrides((prev) => prev.map((r, j) => j === i ? { ...r, hours: e.target.value } : r))}
                          className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                        />
                        <span className="text-sm text-zinc-500">Pay Code:</span>
                        <select
                          value={o.payCodeId}
                          onChange={(e) => setOverrides((prev) => prev.map((r, j) => j === i ? { ...r, payCodeId: e.target.value } : r))}
                          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                        >
                          <option value="">— Select —</option>
                          {payCodes.map((pc) => (
                            <option key={pc.id} value={pc.id}>{pc.code}{pc.label ? ` — ${pc.label}` : ""}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <input type="hidden" name="holidayOverrides" value={JSON.stringify(overrides.slice(0, numOverrides))} />

            </div>
          </CollapsibleSection>

          {/* Birthday */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={birthdayIsHoliday} onChange={(e) => setBirthdayIsHoliday(e.target.checked)} className="rounded" />
            Employee Birthdays are considered a Holiday
          </label>
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

          {/* Apply toggle */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Apply Holiday Prorate Rule?</p>
            <div className="flex gap-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="radio" name="prorateEnabled" value="true"
                  checked={prorateEnabled}
                  onChange={() => setProrateEnabled(true)}
                  className="accent-zinc-900 dark:accent-white" />
                Yes
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="radio" name="prorateEnabled" value="false"
                  checked={!prorateEnabled}
                  onChange={() => setProrateEnabled(false)}
                  className="accent-zinc-900 dark:accent-white" />
                No
              </label>
            </div>
            <input type="hidden" name="prorateEnabled" value={prorateEnabled ? "true" : "false"} />
          </div>

          {prorateEnabled && (
            <>
              {/* Day Range */}
              <CollapsibleSection title="Day Range" defaultOpen={true}>
                <div className="flex flex-col gap-3">

                  <label className="flex flex-wrap cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="radio" checked={!prorateUseCustomRange}
                      onChange={() => setProrateUseCustomRange(false)}
                      className="accent-zinc-900 dark:accent-white" />
                    <span>Look Back</span>
                    <input name="prorateLookbackDays" type="number" min="1" max="365"
                      defaultValue={rule?.prorateLookbackDays ?? 28}
                      className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                    <span>days</span>
                    <select name="prorateIncludeCurrentWeek"
                      defaultValue={rule?.prorateIncludeCurrentWeek !== false ? "true" : "false"}
                      className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">
                      <option value="true">include current week</option>
                      <option value="false">exclude current week</option>
                    </select>
                    <span>to determine total worked hours</span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="radio" checked={prorateUseCustomRange}
                      onChange={() => setProrateUseCustomRange(true)}
                      className="accent-zinc-900 dark:accent-white" />
                    Custom day range to determine total worked hours
                  </label>
                  <input type="hidden" name="prorateUseCustomRange" value={prorateUseCustomRange ? "true" : "false"} />

                </div>
              </CollapsibleSection>

              {/* Applied Rule */}
              <CollapsibleSection title="Applied Rule" defaultOpen={true}>
                <div className="flex flex-col gap-4">

                  <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="radio" checked={prorateAppliedRule === "THRESHOLD"}
                      onChange={() => setProrateAppliedRule("THRESHOLD")}
                      className="mt-0.5 accent-zinc-900 dark:accent-white" />
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>Worked hours are greater or equal</span>
                        <input name="prorateThresholdHours" type="number" step="0.001" min="0"
                          defaultValue={Number(rule?.prorateThresholdHours ?? 0).toFixed(3)}
                          disabled={prorateAppliedRule !== "THRESHOLD"}
                          className={`w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${prorateAppliedRule !== "THRESHOLD" ? "opacity-40" : ""}`} />
                        <span>hours, then employee will get the full amount holiday pay,</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-zinc-500">otherwise prorate total worked hours by multiplying by</span>
                        <input name="prorateMultiplier" type="number" step="0.0000001" min="0"
                          defaultValue={Number(rule?.prorateMultiplier ?? 0).toFixed(7)}
                          disabled={prorateAppliedRule !== "THRESHOLD"}
                          className={`w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${prorateAppliedRule !== "THRESHOLD" ? "opacity-40" : ""}`} />
                      </div>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="radio" checked={prorateAppliedRule === "AVERAGE_DAILY"}
                      onChange={() => setProrateAppliedRule("AVERAGE_DAILY")}
                      className="accent-zinc-900 dark:accent-white" />
                    <span>Pay Average daily worked hours up to</span>
                    <input name="prorateAverageDailyMaxHours" type="number" step="0.001" min="0" max="24"
                      defaultValue={Number(rule?.prorateAverageDailyMaxHours ?? 8).toFixed(3)}
                      disabled={prorateAppliedRule !== "AVERAGE_DAILY"}
                      className={`w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-right focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${prorateAppliedRule !== "AVERAGE_DAILY" ? "opacity-40" : ""}`} />
                  </label>
                  <input type="hidden" name="prorateAppliedRule" value={prorateAppliedRule} />

                </div>
              </CollapsibleSection>

              {/* Exclude OT */}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" name="prorateExcludeOt" value="true"
                  defaultChecked={rule?.prorateExcludeOt ?? false} className="rounded" />
                Exclude Overtime when calculating Work hours
              </label>
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

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Main manager ─────────────────────────────────────────────────────────────

export function HolidayRulesManager({ rules, payCodes = [] }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<HolidayRule | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const visible = showInactive ? rules : rules.filter((r) => r.isActive);

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
    <div className="mt-6">
      {error && !editingRule && !showCreate && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
      )}

      <div className="mb-3 flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
          Show inactive
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && <p className="text-sm text-zinc-400">No holiday rules yet. Add one below.</p>}

        {visible.map((rule) => (
          <button
            key={rule.id}
            type="button"
            onClick={() => openEdit(rule)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-3">
                {rule.number != null && (
                  <span className="font-mono text-sm text-zinc-400">{rule.number}</span>
                )}
                <p className={`font-medium ${rule.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                  {rule.name}
                </p>
                <p className="text-sm text-zinc-500">{formatCredit(rule)}</p>
                {rule.workingPremium > 100 && <p className="text-sm text-zinc-400">{formatPremium(rule)}</p>}
                {(rule.requireDayBefore || rule.requireDayAfter) && (
                  <p className="text-xs text-zinc-400">
                    Requires: {[rule.requireDayBefore && "day before", rule.requireDayAfter && "day after"].filter(Boolean).join(" & ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${rule.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                  {rule.isActive ? "Active" : "Inactive"}
                </span>
                <span className="text-xs text-zinc-400">Click to edit →</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={openCreate}
        className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
      >
        + Add Holiday Rule
      </button>

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Holiday Rule" onClose={closeCreate}>
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
          )}
          <form onSubmit={handleCreate}>
            <HolidayRuleFields payCodes={payCodes} />
            <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
              <button type="button" onClick={closeCreate} className={cancelBtnCls}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editingRule && (
        <Modal title={`Edit: ${editingRule.name}`} onClose={closeEdit}>
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
          )}
          <form onSubmit={(e) => handleUpdate(editingRule, e)}>
            <HolidayRuleFields rule={editingRule} isEdit payCodes={payCodes} />
            <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <div className="flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save changes"}</button>
                <button type="button" onClick={closeEdit} className={cancelBtnCls}>Cancel</button>
              </div>
              {confirmDeleteId === editingRule.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Are you sure?</span>
                  <button type="button" onClick={() => handleDelete(editingRule.id)} disabled={isPending} className={dangerBtnCls}>
                    {isPending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteId(editingRule.id)} className="text-xs text-red-500 hover:underline dark:text-red-400">
                  Delete rule
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
