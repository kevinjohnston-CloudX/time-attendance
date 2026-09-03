"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createShift, updateShift, deleteShift } from "@/actions/shift.actions";
import type { DayScheduleRow, MealConfig, BreakConfig, DifferentialConfig } from "@/actions/shift.actions";
import type { Shift } from "@prisma/client";

interface Props { shifts: Shift[] }

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const cellInputCls =
  "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function defaultDaySchedule(shift?: Shift): DayScheduleRow[] {
  const existingSchedule = shift?.daySchedule as DayScheduleRow[] | null | undefined;
  if (existingSchedule && Array.isArray(existingSchedule) && existingSchedule.length === 7) {
    return existingSchedule;
  }
  // Bootstrap from legacy workDays + startTime/endTime
  const workDays = shift?.workDays ?? [1, 2, 3, 4, 5];
  return DAY_NAMES.map((_, i) => ({
    day: i,
    isWorkday: workDays.includes(i),
    dayStart: "00:00",
    dayEnd: "23:59",
    startTime: workDays.includes(i) ? (shift?.startTime ?? null) : null,
    endTime: workDays.includes(i) ? (shift?.endTime ?? null) : null,
    mealMinutes: 0,
  }));
}

function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function formatWorkDays(workDays: number[]): string {
  if (workDays.length === 0) return "No days";
  if (workDays.length === 7) return "Every day";
  const sorted = [...workDays].sort((a, b) => a - b);
  if (sorted.length === 5 && sorted[0] === 1 && sorted[4] === 5) return "Mon – Fri";
  if (sorted.length === 6 && sorted[0] === 1 && sorted[5] === 6) return "Mon – Sat";
  return sorted.map((d) => DAY_NAMES[d]).join(", ");
}

function toDateInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

// ─── Definition table ─────────────────────────────────────────────────────────

function DefinitionTable({
  schedule,
  onChange,
}: {
  schedule: DayScheduleRow[];
  onChange: (s: DayScheduleRow[]) => void;
}) {
  const [fillStart, setFillStart] = useState("08:00");
  const [fillEnd, setFillEnd] = useState("16:30");

  function update(day: number, patch: Partial<DayScheduleRow>) {
    onChange(schedule.map((r) => (r.day === day ? { ...r, ...patch } : r)));
  }

  function applyFill() {
    onChange(schedule.map((r) =>
      r.isWorkday ? { ...r, startTime: fillStart, endTime: fillEnd } : r
    ));
  }

  return (
    <div>
      {/* Quick-fill bar */}
      <div className="mb-3 flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/60">
        <span className="shrink-0 text-xs text-zinc-500">Apply to workdays:</span>
        <input type="time" value={fillStart} onChange={(e) => setFillStart(e.target.value)} className={cellInputCls} />
        <span className="text-xs text-zinc-400">–</span>
        <input type="time" value={fillEnd} onChange={(e) => setFillEnd(e.target.value)} className={cellInputCls} />
        <button
          type="button"
          onClick={applyFill}
          className="ml-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
        >
          Apply
        </button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700">
            <th className="pb-2 text-left font-medium uppercase tracking-wide text-zinc-400" style={{width:"10%"}}>Day</th>
            <th className="pb-2 text-center font-medium uppercase tracking-wide text-zinc-400" style={{width:"10%"}}>Workday</th>
            <th className="pb-2 text-center font-medium uppercase tracking-wide text-zinc-400" style={{width:"28%"}}>Day Window</th>
            <th className="pb-2 text-center font-medium uppercase tracking-wide text-zinc-400" style={{width:"22%"}}>Start Time</th>
            <th className="pb-2 text-center font-medium uppercase tracking-wide text-zinc-400" style={{width:"22%"}}>End Time</th>
            <th className="pb-2 text-center font-medium uppercase tracking-wide text-zinc-400" style={{width:"8%"}}>Meal</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((row) => (
            <tr key={row.day} className="border-b border-zinc-100 dark:border-zinc-800">
              {/* Day */}
              <td className={`py-2 font-medium ${row.isWorkday ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                {DAY_NAMES[row.day]}
              </td>

              {/* Workday checkbox */}
              <td className="py-2 text-center">
                <input
                  type="checkbox"
                  checked={row.isWorkday}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    update(row.day, {
                      isWorkday: checked,
                      startTime: checked ? (row.startTime ?? "08:00") : null,
                      endTime: checked ? (row.endTime ?? "17:00") : null,
                    });
                  }}
                  className="h-4 w-4 cursor-pointer rounded"
                />
              </td>

              {/* Day Window (Start – End combined) */}
              <td className="py-2 pr-2">
                <div className="flex items-center gap-1">
                  <input
                    type="time"
                    value={row.dayStart}
                    onChange={(e) => update(row.day, { dayStart: e.target.value })}
                    className={cellInputCls}
                  />
                  <span className="shrink-0 text-zinc-400">–</span>
                  <input
                    type="time"
                    value={row.dayEnd}
                    onChange={(e) => update(row.day, { dayEnd: e.target.value })}
                    className={cellInputCls}
                  />
                </div>
              </td>

              {/* Start Time */}
              <td className="py-2 pr-2">
                {row.isWorkday ? (
                  <input
                    type="time"
                    value={row.startTime ?? ""}
                    onChange={(e) => update(row.day, { startTime: e.target.value || null })}
                    className={cellInputCls}
                  />
                ) : (
                  <span className="text-zinc-300 dark:text-zinc-600">—</span>
                )}
              </td>

              {/* End Time */}
              <td className="py-2 pr-2">
                {row.isWorkday ? (
                  <input
                    type="time"
                    value={row.endTime ?? ""}
                    onChange={(e) => update(row.day, { endTime: e.target.value || null })}
                    className={cellInputCls}
                  />
                ) : (
                  <span className="text-zinc-300 dark:text-zinc-600">—</span>
                )}
              </td>

              {/* Meal minutes */}
              <td className="py-2">
                <input
                  type="number"
                  min={0}
                  max={480}
                  value={row.mealMinutes}
                  onChange={(e) => update(row.day, { mealMinutes: parseInt(e.target.value, 10) || 0 })}
                  className={`${cellInputCls} text-right`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-zinc-400">Day Window = punch eligibility window for that day (default 00:00 – 23:59). Meal = scheduled break in minutes.</p>
    </div>
  );
}

// ─── Meal config defaults + tab ───────────────────────────────────────────────

function defaultMealConfig(shift?: Shift): MealConfig {
  const existing = shift?.mealConfig as MealConfig | null | undefined;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) return existing;
  return {
    deductionMethod: "HOURS_WORKED",
    minMealMinutes: 15,
    maxMealMinutes: 180,
    reimbursementEnabled: false,
    reimbursementMinutes: 0,
    dailyReimbursementLimitMinutes: 0,
    doesNotAffectLongMealException: false,
    autoDeduct: false,
    noMealPunchBonusEnabled: false,
    noMealPunchBonusMinutes: 30,
    noMealPunchBonusWorkHours: 5,
    disableMinDeduction: false,
    useMealWindowForAutoDeduct: false,
    createMealDeductionEnabled: false,
    createMealDeductionHours: 5,
    doNotSplitPunch: false,
    createMealBasis: "IN_OUT_PAIR",
    absoluteDeductionWindow: false,
    alwaysUseScheduledMeals: false,
    lateOutToMealEnabled: false,
    lateOutToMealHours: 0,
    sendWaivedToPayCode: false,
    waivedPayCodeId: "",
    meals: [
      { mealBeforeHours: 0, workAtLeastHours: 5, deductMinutes: 30 },
      { mealBeforeHours: 0, workAtLeastHours: 0, deductMinutes: 0 },
      { mealBeforeHours: 0, workAtLeastHours: 0, deductMinutes: 0 },
      { mealBeforeHours: 0, workAtLeastHours: 0, deductMinutes: 0 },
    ],
  };
}

const MEAL_LABELS = ["First", "Second", "Third", "Fourth"] as const;

function MealTab({ cfg, onChange }: { cfg: MealConfig; onChange: (c: MealConfig) => void }) {
  function set<K extends keyof MealConfig>(key: K, val: MealConfig[K]) {
    onChange({ ...cfg, [key]: val });
  }
  function setMeal(i: number, patch: Partial<MealConfig["meals"][0]>) {
    const meals = cfg.meals.map((m, idx) => (idx === i ? { ...m, ...patch } : m));
    onChange({ ...cfg, meals });
  }

  const checkboxLabelCls = "flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300";
  const subFieldCls = "ml-6 mt-2";
  const numInputCls = "w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white text-right";
  const radioLabelCls = "flex items-center gap-2 cursor-pointer text-sm text-zinc-700 dark:text-zinc-300";
  const sectionLabelCls = "mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400";

  return (
    <div className="flex flex-col gap-5">

      {/* Deduction Method */}
      <div>
        <p className={sectionLabelCls}>Deduction Method</p>
        <div className="flex flex-col gap-1.5">
          {([
            ["HOURS_WORKED", "Hours Worked"],
            ["TIME_PERIOD", "Time Period"],
            ["SHIFT_PERIOD", "Shift Period"],
            ["ALLOWANCE_BY_HOURS", "Allowance by Hours"],
            ["ALLOWANCE_BY_TIME", "Allowance by Time"],
          ] as const).map(([val, label]) => (
            <label key={val} className={radioLabelCls}>
              <input type="radio" checked={cfg.deductionMethod === val}
                onChange={() => set("deductionMethod", val)}
                className="accent-zinc-900 dark:accent-zinc-100" />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Punch gap */}
      <div>
        <p className={sectionLabelCls}>Rules</p>
        <p className="mb-3 text-xs text-zinc-500">
          Meal punch recognized when punch gap is between{" "}
          <input type="number" min={1} max={60} value={cfg.minMealMinutes}
            onChange={(e) => set("minMealMinutes", parseInt(e.target.value) || 15)}
            className={numInputCls} />{" "}
          and{" "}
          <input type="number" min={1} max={480} value={cfg.maxMealMinutes}
            onChange={(e) => set("maxMealMinutes", parseInt(e.target.value) || 180)}
            className={numInputCls} />{" "}
          minutes
        </p>

        {/* Allow Pay Reimbursement */}
        <div className="mb-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" checked={cfg.reimbursementEnabled}
              onChange={(e) => set("reimbursementEnabled", e.target.checked)} className="mt-0.5 rounded" />
            Allow Pay Reimbursement
          </label>
          {cfg.reimbursementEnabled && (
            <div className={`${subFieldCls} flex flex-col gap-2`}>
              <p className="text-xs text-zinc-500">
                Up to{" "}
                <input type="number" min={0} value={cfg.reimbursementMinutes}
                  onChange={(e) => set("reimbursementMinutes", parseInt(e.target.value) || 0)}
                  className={numInputCls} />{" "}
                min &nbsp;|&nbsp; Daily limit{" "}
                <input type="number" min={0} value={cfg.dailyReimbursementLimitMinutes}
                  onChange={(e) => set("dailyReimbursementLimitMinutes", parseInt(e.target.value) || 0)}
                  className={numInputCls} />{" "}
                min
              </p>
              <label className={checkboxLabelCls}>
                <input type="checkbox" checked={cfg.doesNotAffectLongMealException}
                  onChange={(e) => set("doesNotAffectLongMealException", e.target.checked)} className="rounded" />
                Does not affect long meal exception
              </label>
            </div>
          )}
        </div>

        {/* Auto deduct */}
        <div className="mb-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" checked={cfg.autoDeduct}
              onChange={(e) => set("autoDeduct", e.target.checked)} className="mt-0.5 rounded" />
            Automatically deduct the established minimum meal below
          </label>
        </div>

        {/* No Meal Punch Bonus */}
        <div className="mb-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" checked={cfg.noMealPunchBonusEnabled}
              onChange={(e) => set("noMealPunchBonusEnabled", e.target.checked)} className="mt-0.5 rounded" />
            No Meal Punch Bonus
          </label>
          {cfg.noMealPunchBonusEnabled && (
            <p className={`${subFieldCls} text-xs text-zinc-500`}>
              <input type="number" min={0} value={cfg.noMealPunchBonusMinutes}
                onChange={(e) => set("noMealPunchBonusMinutes", parseInt(e.target.value) || 0)}
                className={numInputCls} />{" "}
              minutes if employee works more than{" "}
              <input type="number" min={0} step={0.5} value={cfg.noMealPunchBonusWorkHours}
                onChange={(e) => set("noMealPunchBonusWorkHours", parseFloat(e.target.value) || 0)}
                className={numInputCls} />{" "}
              hours
            </p>
          )}
        </div>

        {/* Disable min deduction */}
        <div className="mb-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" checked={cfg.disableMinDeduction}
              onChange={(e) => set("disableMinDeduction", e.target.checked)} className="mt-0.5 rounded" />
            Disable minimum deduction (use actual meal time)
          </label>
        </div>

        {/* Use Meal Window for auto deduct */}
        <div className="mb-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" checked={cfg.useMealWindowForAutoDeduct}
              onChange={(e) => set("useMealWindowForAutoDeduct", e.target.checked)} className="mt-0.5 rounded" />
            Use Meal Window for auto deduct
          </label>
        </div>

        {/* Create meal deduction */}
        <div className="mb-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" checked={cfg.createMealDeductionEnabled}
              onChange={(e) => set("createMealDeductionEnabled", e.target.checked)} className="mt-0.5 rounded" />
            Create meal deduction
          </label>
          {cfg.createMealDeductionEnabled && (
            <div className={`${subFieldCls} flex flex-col gap-2`}>
              <p className="text-xs text-zinc-500">
                <input type="number" min={0} step={0.5} value={cfg.createMealDeductionHours}
                  onChange={(e) => set("createMealDeductionHours", parseFloat(e.target.value) || 0)}
                  className={numInputCls} />{" "}
                hours after punching in
              </p>
              <label className={checkboxLabelCls}>
                <input type="checkbox" checked={cfg.doNotSplitPunch}
                  onChange={(e) => set("doNotSplitPunch", e.target.checked)} className="rounded" />
                Do not split punch
              </label>
              <div className="flex gap-4">
                {([["IN_OUT_PAIR", "In/Out Pair"], ["WORKING_HOURS", "Working Hours"]] as const).map(([val, label]) => (
                  <label key={val} className={radioLabelCls}>
                    <input type="radio" checked={cfg.createMealBasis === val}
                      onChange={() => set("createMealBasis", val)}
                      className="accent-zinc-900 dark:accent-zinc-100" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Absolute deduction window */}
        <div className="mb-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" checked={cfg.absoluteDeductionWindow}
              onChange={(e) => set("absoluteDeductionWindow", e.target.checked)} className="mt-0.5 rounded" />
            Absolute deduction window
          </label>
        </div>

        {/* Always use scheduled meals */}
        <div className="mb-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" checked={cfg.alwaysUseScheduledMeals}
              onChange={(e) => set("alwaysUseScheduledMeals", e.target.checked)} className="mt-0.5 rounded" />
            Always use scheduled meals
          </label>
        </div>

        {/* Late Out to Meal */}
        <div className="mb-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" checked={cfg.lateOutToMealEnabled}
              onChange={(e) => set("lateOutToMealEnabled", e.target.checked)} className="mt-0.5 rounded" />
            Late Out to Meal
          </label>
          {cfg.lateOutToMealEnabled && (
            <p className={`${subFieldCls} text-xs text-zinc-500`}>
              After{" "}
              <input type="number" min={0} step={0.5} value={cfg.lateOutToMealHours}
                onChange={(e) => set("lateOutToMealHours", parseFloat(e.target.value) || 0)}
                className={numInputCls} />{" "}
              hours
            </p>
          )}
        </div>

        {/* Send waived hours to pay code */}
        <div className="mb-2">
          <label className={checkboxLabelCls}>
            <input type="checkbox" checked={cfg.sendWaivedToPayCode}
              onChange={(e) => set("sendWaivedToPayCode", e.target.checked)} className="mt-0.5 rounded" />
            Send waived hours to pay code
          </label>
          {cfg.sendWaivedToPayCode && (
            <div className={subFieldCls}>
              <input type="text" placeholder="Pay code ID"
                value={cfg.waivedPayCodeId}
                onChange={(e) => set("waivedPayCodeId", e.target.value)}
                className={`${numInputCls} w-40`} />
            </div>
          )}
        </div>
      </div>

      {/* Meal table */}
      <div>
        <p className={sectionLabelCls}>Meal Schedule</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="pb-2 text-left font-medium uppercase tracking-wide text-zinc-400 w-20">Meal</th>
                <th className="pb-2 text-center font-medium uppercase tracking-wide text-zinc-400 w-36">Meal Before (hrs)</th>
                <th className="pb-2 text-center font-medium uppercase tracking-wide text-zinc-400 w-36">Work At Least (hrs)</th>
                <th className="pb-2 text-center font-medium uppercase tracking-wide text-zinc-400 w-28">Deduct (min)</th>
              </tr>
            </thead>
            <tbody>
              {MEAL_LABELS.map((label, i) => (
                <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 font-medium text-zinc-600 dark:text-zinc-400">{label}</td>
                  <td className="py-2 px-2 text-center">
                    <input type="number" min={0} step={0.25} value={cfg.meals[i].mealBeforeHours}
                      onChange={(e) => setMeal(i, { mealBeforeHours: parseFloat(e.target.value) || 0 })}
                      className={`${numInputCls} w-full`} />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <input type="number" min={0} step={0.25} value={cfg.meals[i].workAtLeastHours}
                      onChange={(e) => setMeal(i, { workAtLeastHours: parseFloat(e.target.value) || 0 })}
                      className={`${numInputCls} w-full`} />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <input type="number" min={0} value={cfg.meals[i].deductMinutes}
                      onChange={(e) => setMeal(i, { deductMinutes: parseInt(e.target.value) || 0 })}
                      className={`${numInputCls} w-full`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-zinc-400">
          Meal Before = meal window starts before scheduled end. Work At Least = minimum hours worked to trigger deduction.
        </p>
      </div>

    </div>
  );
}

// ─── Break config defaults + tab ─────────────────────────────────────────────

function defaultBreakConfig(shift?: Shift): BreakConfig {
  const existing = shift?.breakConfig as BreakConfig | null | undefined;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) return existing;
  return {
    applyPaidBreak: false,
    payMethod: "OFF_CLOCK_MINS",
    punchOutWithinMinutes: 0,
    payUpToMinutes: 0,
  };
}

function BreakTab({ cfg, onChange }: { cfg: BreakConfig; onChange: (c: BreakConfig) => void }) {
  function set<K extends keyof BreakConfig>(key: K, val: BreakConfig[K]) {
    onChange({ ...cfg, [key]: val });
  }

  const radioLabelCls = "flex items-center gap-2 cursor-pointer text-sm text-zinc-700 dark:text-zinc-300";
  const sectionLabelCls = "mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400";
  const numInputCls =
    "w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white text-right";

  return (
    <div className="flex flex-col gap-5">

      {/* Apply paid break */}
      <div>
        <p className={sectionLabelCls}>Apply Paid Break?</p>
        <div className="flex gap-4">
          <label className={radioLabelCls}>
            <input type="radio" checked={cfg.applyPaidBreak}
              onChange={() => set("applyPaidBreak", true)}
              className="accent-zinc-900 dark:accent-zinc-100" />
            Yes
          </label>
          <label className={radioLabelCls}>
            <input type="radio" checked={!cfg.applyPaidBreak}
              onChange={() => set("applyPaidBreak", false)}
              className="accent-zinc-900 dark:accent-zinc-100" />
            No
          </label>
        </div>
      </div>

      {cfg.applyPaidBreak && (
        <>
          {/* Pay Method */}
          <div>
            <p className={sectionLabelCls}>Pay Method</p>
            <div className="flex flex-col gap-1.5">
              {([
                ["OFF_CLOCK_MINS", "Off-Clock Mins", "Pay based on how long the employee was actually punched out"],
                ["TIME_PERIOD", "Time Period", "Pay a fixed break duration regardless of actual punch gap"],
                ["WORK_HOURS", "Work Hours", "Allocate break pay based on total hours worked"],
              ] as const).map(([val, label, desc]) => (
                <label key={val} className="flex cursor-pointer items-start gap-2">
                  <input type="radio" checked={cfg.payMethod === val}
                    onChange={() => set("payMethod", val)}
                    className="mt-0.5 accent-zinc-900 dark:accent-zinc-100" />
                  <span>
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">{label}</span>
                    <span className="ml-2 text-xs text-zinc-400">{desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Punch window + pay cap */}
          <div className="flex flex-col gap-3">
            <p className={sectionLabelCls}>Break Recognition</p>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Considered a paid break when punch-out is within{" "}
              <input
                type="number" min={0} max={480} value={cfg.punchOutWithinMinutes}
                onChange={(e) => set("punchOutWithinMinutes", parseInt(e.target.value) || 0)}
                className={numInputCls}
              />{" "}
              min
            </p>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Pay up to{" "}
              <input
                type="number" min={0} max={480} value={cfg.payUpToMinutes}
                onChange={(e) => set("payUpToMinutes", parseInt(e.target.value) || 0)}
                className={numInputCls}
              />{" "}
              min
            </p>
          </div>
        </>
      )}

    </div>
  );
}

// ─── Differential config defaults + tab ──────────────────────────────────────

function defaultDifferentialConfig(shift?: Shift): DifferentialConfig {
  const existing = shift?.differentialConfig as DifferentialConfig | null | undefined;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) return existing;
  return { applyDifferential: false, payMethod: "TIME_SEGMENT" };
}

function DifferentialTab({ cfg, onChange }: { cfg: DifferentialConfig; onChange: (c: DifferentialConfig) => void }) {
  function set<K extends keyof DifferentialConfig>(key: K, val: DifferentialConfig[K]) {
    onChange({ ...cfg, [key]: val });
  }

  const radioLabelCls = "flex items-center gap-2 cursor-pointer text-sm text-zinc-700 dark:text-zinc-300";
  const sectionLabelCls = "mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400";

  return (
    <div className="flex flex-col gap-5">

      {/* Apply differential */}
      <div>
        <p className={sectionLabelCls}>Apply Pay Differential?</p>
        <div className="flex gap-4">
          <label className={radioLabelCls}>
            <input type="radio" checked={cfg.applyDifferential}
              onChange={() => set("applyDifferential", true)}
              className="accent-zinc-900 dark:accent-zinc-100" />
            Yes
          </label>
          <label className={radioLabelCls}>
            <input type="radio" checked={!cfg.applyDifferential}
              onChange={() => set("applyDifferential", false)}
              className="accent-zinc-900 dark:accent-zinc-100" />
            No
          </label>
        </div>
      </div>

      {cfg.applyDifferential && (
        <div>
          <p className={sectionLabelCls}>Pay Method</p>
          <p className="mb-3 text-xs text-zinc-400">
            If no Global Template is found, the system will use the Time Segment settings.
          </p>
          <div className="flex flex-col gap-1.5">
            {([
              ["TIME_SEGMENT", "Time Segment", "Differential applied to each time segment worked (e.g. overnight hours)"],
              ["SHIFT_PERIOD", "Shift Period", "Differential applied to the entire shift period"],
              ["GLOBAL_DIFFERENTIAL", "Global Differential", "Uses a global differential template"],
            ] as const).map(([val, label, desc]) => (
              <label key={val} className="flex cursor-pointer items-start gap-2">
                <input type="radio" checked={cfg.payMethod === val}
                  onChange={() => set("payMethod", val)}
                  className="mt-0.5 accent-zinc-900 dark:accent-zinc-100" />
                <span>
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{label}</span>
                  <span className="ml-2 text-xs text-zinc-400">{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Shift fields with tabs ───────────────────────────────────────────────────

type ShiftTab = "properties" | "definition" | "meal" | "break" | "differential";

function ShiftFields({ shift, isEdit }: { shift?: Shift; isEdit?: boolean }) {
  const [tab, setTab] = useState<ShiftTab>("properties");
  const [schedule, setSchedule] = useState<DayScheduleRow[]>(() => defaultDaySchedule(shift));
  const [mealConfig, setMealConfig] = useState<MealConfig>(() => defaultMealConfig(shift));
  const [breakConfig, setBreakConfig] = useState<BreakConfig>(() => defaultBreakConfig(shift));
  const [differentialConfig, setDifferentialConfig] = useState<DifferentialConfig>(() => defaultDifferentialConfig(shift));

  const [excludeFromSetup, setExcludeFromSetup] = useState(shift?.excludeFromSetup ?? false);
  const [shiftCycle, setShiftCycle] = useState<"WEEKLY" | "CUSTOM">(shift?.shiftCycle ?? "WEEKLY");
  const [shiftType, setShiftType] = useState<"FIXED" | "FLEXIBLE" | "DYNAMIC">(shift?.shiftType ?? "FIXED");
  const [useGroupQualifiers, setUseGroupQualifiers] = useState(shift?.useScheduleGroupQualifiers ?? false);

  const tabs: { key: ShiftTab; label: string }[] = [
    { key: "properties", label: "Properties" },
    { key: "definition", label: "Definition" },
    { key: "meal", label: "Meal" },
    { key: "break", label: "Break" },
    { key: "differential", label: "Differential" },
  ];

  const radioLabelCls = "flex items-center gap-2 cursor-pointer text-sm text-zinc-700 dark:text-zinc-300";
  const sectionLabelCls = "mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400";

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

      {/* Properties tab — always mounted so defaultValue inputs survive tab switches */}
      <div className={tab !== "properties" ? "hidden" : "flex flex-col gap-4"}>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Shift Name</label>
              <input name="name" required defaultValue={shift?.name ?? ""} placeholder="e.g. Morning Shift" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Shift Number</label>
              <input name="number" type="number" min={1} defaultValue={shift?.number ?? ""} placeholder="e.g. 1" className={inputCls} />
            </div>
          </div>

          {isEdit && (
            <div className="w-40">
              <label className="mb-1 block text-xs text-zinc-500">Status</label>
              <select name="isActive" defaultValue={shift?.isActive ? "true" : "false"} className={inputCls}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          )}

          {/* Employee Setup */}
          <div>
            <p className={sectionLabelCls}>Employee Setup</p>
            <div className="flex flex-col gap-1.5">
              <label className={radioLabelCls}>
                <input type="radio" name="excludeFromSetup" value="false" checked={!excludeFromSetup}
                  onChange={() => setExcludeFromSetup(false)} className="accent-zinc-900 dark:accent-zinc-100" />
                Include — visible in employee assignment list
              </label>
              <label className={radioLabelCls}>
                <input type="radio" name="excludeFromSetup" value="true" checked={excludeFromSetup}
                  onChange={() => setExcludeFromSetup(true)} className="accent-zinc-900 dark:accent-zinc-100" />
                Exclude — hidden from assignment list
              </label>
            </div>
          </div>

          {/* Shift Cycle */}
          <div>
            <p className={sectionLabelCls}>Shift Cycle</p>
            <div className="flex flex-col gap-1.5">
              <label className={radioLabelCls}>
                <input type="radio" name="shiftCycle" value="WEEKLY" checked={shiftCycle === "WEEKLY"}
                  onChange={() => setShiftCycle("WEEKLY")} className="accent-zinc-900 dark:accent-zinc-100" />
                Weekly
              </label>
              <label className={radioLabelCls}>
                <input type="radio" name="shiftCycle" value="CUSTOM" checked={shiftCycle === "CUSTOM"}
                  onChange={() => setShiftCycle("CUSTOM")} className="accent-zinc-900 dark:accent-zinc-100" />
                Custom
              </label>
            </div>
            {shiftCycle === "CUSTOM" && (
              <div className="mt-3 grid grid-cols-2 gap-3 pl-6">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Cycle Days</label>
                  <input name="cycleDays" type="number" min={1} max={365} defaultValue={shift?.cycleDays ?? 7} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Reference Date</label>
                  <input name="cycleReferenceDate" type="date" defaultValue={toDateInputValue(shift?.cycleReferenceDate)} className={inputCls} />
                </div>
              </div>
            )}
          </div>

          {/* Shift Type */}
          <div>
            <p className={sectionLabelCls}>Shift Type</p>
            <div className="flex flex-col gap-1.5">
              {(["FIXED", "FLEXIBLE", "DYNAMIC"] as const).map((type) => (
                <label key={type} className={radioLabelCls}>
                  <input type="radio" name="shiftType" value={type} checked={shiftType === type}
                    onChange={() => setShiftType(type)} className="accent-zinc-900 dark:accent-zinc-100" />
                  {type.charAt(0) + type.slice(1).toLowerCase()}
                </label>
              ))}
            </div>
            {shiftType === "DYNAMIC" && (
              <label className="mt-2 flex cursor-pointer items-center gap-2 pl-6 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={useGroupQualifiers}
                  onChange={(e) => setUseGroupQualifiers(e.target.checked)} className="rounded" />
                Use Schedule Group Qualifiers
              </label>
            )}
            <input type="hidden" name="useScheduleGroupQualifiers" value={useGroupQualifiers ? "true" : "false"} />
          </div>

          {/* Average Hours */}
          <div className="w-40">
            <label className="mb-1 block text-xs text-zinc-500">Average Hours</label>
            <input name="averageHours" type="number" min={0} max={24} step={0.25}
              defaultValue={shift?.averageHours != null ? Number(shift.averageHours) : ""}
              placeholder="0.00" className={inputCls} />
          </div>

      </div>

      {/* Definition tab */}
      {tab === "definition" && (
        <DefinitionTable schedule={schedule} onChange={setSchedule} />
      )}

      {/* Meal tab */}
      {tab === "meal" && (
        <MealTab cfg={mealConfig} onChange={setMealConfig} />
      )}

      {/* Break tab */}
      {tab === "break" && (
        <BreakTab cfg={breakConfig} onChange={setBreakConfig} />
      )}

      {/* Differential tab */}
      {tab === "differential" && (
        <DifferentialTab cfg={differentialConfig} onChange={setDifferentialConfig} />
      )}

      {/* Hidden: serialized for form submission */}
      <input type="hidden" name="dayScheduleJson" value={JSON.stringify(schedule)} />
      <input type="hidden" name="mealConfigJson" value={JSON.stringify(mealConfig)} />
      <input type="hidden" name="breakConfigJson" value={JSON.stringify(breakConfig)} />
      <input type="hidden" name="differentialConfigJson" value={JSON.stringify(differentialConfig)} />
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
          <button onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close">
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

// ─── Form parsing ─────────────────────────────────────────────────────────────

function parseShiftForm(fd: FormData) {
  const numberRaw = parseInt(fd.get("number") as string, 10);
  const avgRaw = parseFloat(fd.get("averageHours") as string);
  const cycleDaysRaw = parseInt(fd.get("cycleDays") as string, 10);
  const shiftCycle = (fd.get("shiftCycle") as string) || "WEEKLY";
  const dayScheduleRaw = fd.get("dayScheduleJson") as string;
  let daySchedule: DayScheduleRow[] | undefined;
  try { daySchedule = JSON.parse(dayScheduleRaw); } catch { daySchedule = undefined; }

  const mealConfigRaw = fd.get("mealConfigJson") as string;
  let mealConfig: MealConfig | undefined;
  try { mealConfig = JSON.parse(mealConfigRaw); } catch { mealConfig = undefined; }

  const breakConfigRaw = fd.get("breakConfigJson") as string;
  let breakConfig: BreakConfig | undefined;
  try { breakConfig = JSON.parse(breakConfigRaw); } catch { breakConfig = undefined; }

  const differentialConfigRaw = fd.get("differentialConfigJson") as string;
  let differentialConfig: DifferentialConfig | undefined;
  try { differentialConfig = JSON.parse(differentialConfigRaw); } catch { differentialConfig = undefined; }

  return {
    name: fd.get("name") as string,
    number: isNaN(numberRaw) || numberRaw < 1 ? null : numberRaw,
    workDays: [] as number[], // derived from daySchedule in the action
    mealBreakStart: (fd.get("mealBreakStart") as string) || "",
    mealBreakEnd:   (fd.get("mealBreakEnd")   as string) || "",
    excludeFromSetup: fd.get("excludeFromSetup") === "true",
    shiftCycle: shiftCycle as "WEEKLY" | "CUSTOM",
    cycleDays: isNaN(cycleDaysRaw) || cycleDaysRaw < 1 ? 7 : cycleDaysRaw,
    cycleReferenceDate: shiftCycle === "CUSTOM" ? ((fd.get("cycleReferenceDate") as string) || null) : null,
    shiftType: ((fd.get("shiftType") as string) || "FIXED") as "FIXED" | "FLEXIBLE" | "DYNAMIC",
    useScheduleGroupQualifiers: fd.get("useScheduleGroupQualifiers") === "true",
    averageHours: isNaN(avgRaw) ? null : avgRaw,
    daySchedule,
    mealConfig,
    breakConfig,
    differentialConfig,
  };
}

// ─── Main manager ─────────────────────────────────────────────────────────────

export function ShiftsManager({ shifts }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }
  const visible = showInactive ? shifts : shifts.filter((s) => s.isActive);

  function openEdit(shift: Shift) { setEditingShift(shift); setConfirmDeleteId(null); setError(null); }
  function closeModal() { setEditingShift(null); setConfirmDeleteId(null); setError(null); }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseShiftForm(new FormData(e.currentTarget));
    setError(null);
    startTransition(async () => {
      const result = await createShift(parsed);
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(shift: Shift, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = parseShiftForm(fd);
    const isActive = (fd.get("isActive") as string) === "true";
    setError(null);
    startTransition(async () => {
      const result = await updateShift({ shiftId: shift.id, isActive, ...parsed });
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      closeModal();
      router.refresh();
    });
  }

  function handleDelete(shiftId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteShift({ shiftId });
      if (!result.success) { setError((result as { success: false; error: string }).error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      closeModal();
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      {error && !editingShift && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
      )}

      <div className="mb-3 flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
          Show inactive
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && <p className="text-sm text-zinc-400">No shifts yet. Add one below.</p>}

        {visible.map((shift) => {
          const sched = shift.daySchedule as DayScheduleRow[] | null;
          const workDays = sched ? sched.filter((r) => r.isWorkday).map((r) => r.day) : shift.workDays;
          const firstWork = sched?.find((r) => r.isWorkday && r.startTime && r.endTime);
          return (
            <button key={shift.id} type="button" onClick={() => openEdit(shift)}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <p className={`font-medium ${shift.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                    {shift.number != null && <span className="mr-2 text-sm text-zinc-400">#{shift.number}</span>}
                    {shift.name}
                  </p>
                  {firstWork ? (
                    <p className="text-sm text-zinc-500">
                      {formatTime(firstWork.startTime)} – {formatTime(firstWork.endTime)}
                    </p>
                  ) : (
                    <p className="text-sm text-zinc-500">
                      {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                    </p>
                  )}
                  <p className="text-sm text-zinc-400">{formatWorkDays(workDays)}</p>
                  <span className="text-xs text-zinc-400">{shift.shiftType.charAt(0) + shift.shiftType.slice(1).toLowerCase()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${shift.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                    {shift.isActive ? "Active" : "Inactive"}
                  </span>
                  <span className="text-xs text-zinc-400">Click to edit →</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <button onClick={openCreate}
        className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600">
        + Add Shift
      </button>

      {showCreate && (
        <Modal title="New Shift" onClose={closeCreate}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          <form onSubmit={handleCreate}>
            <ShiftFields />
            <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
              <button type="button" onClick={closeCreate} className={cancelBtnCls}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {editingShift && (
        <Modal title={`Edit: ${editingShift.name}`} onClose={closeModal}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          <form onSubmit={(e) => handleUpdate(editingShift, e)}>
            <ShiftFields shift={editingShift} isEdit />
            <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <div className="flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save changes"}</button>
                <button type="button" onClick={closeModal} className={cancelBtnCls}>Cancel</button>
              </div>
              {confirmDeleteId === editingShift.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Are you sure?</span>
                  <button type="button" onClick={() => handleDelete(editingShift.id)} disabled={isPending} className={dangerBtnCls}>
                    {isPending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteId(editingShift.id)} className="text-xs text-red-500 hover:underline dark:text-red-400">
                  Delete shift
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
