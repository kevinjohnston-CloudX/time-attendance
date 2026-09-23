"use client";

import { Fragment, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createRuleSet, updateRuleSet, deleteRuleSet } from "@/actions/admin.actions";
import type { AutoPayMode, OtCycle, RuleSet } from "@prisma/client";

const PAY_FREQUENCIES = [
  { value: "WEEKLY", label: "Weekly (every 7 days)" },
  { value: "BIWEEKLY", label: "Bi-weekly (every 14 days)" },
  { value: "SEMIMONTHLY", label: "Semi-monthly (1st–15th and 16th–end)" },
  { value: "MONTHLY", label: "Monthly (1st–end of month)" },
] as const;

interface Props { ruleSets: RuleSet[]; payCodes: { id: string; code: number; label: string }[] }

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const smInputCls = "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls = "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";
const sectionHdrCls = "col-span-full mb-0.5 border-b border-zinc-200 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-700";

type AutoPayDaySchedule = { day: number; apply: boolean; minutes: number }[];
type RSFields = Omit<RuleSet, "id" | "tenantId" | "createdAt" | "updatedAt" | "employees" | "payPeriods" | "isActive" | "payPeriodAnchorDate" | "otCycleAnchorDate" | "otCycle" | "mealPremiumRows" | "autoPayDaySchedule" | "flsaOtLevels" | "flsaIncludeAsRegular" | "flsaType" | "flsaDistributionFrequency" | "flsaWeeklyOtLevel" | "flsaOtRateComputation"> & { isActive?: boolean; payPeriodAnchorDate?: string | null; otCycleAnchorDate?: string | null; otCycle?: OtCycle | null; mealPremiumRows?: MealPremiumRow[]; autoPayDaySchedule?: AutoPayDaySchedule; flsaOtLevels?: string[]; flsaIncludeAsRegular?: string[]; flsaType: "FEDERAL" | "CALIFORNIA"; flsaDistributionFrequency: "PER_PERIOD" | "WEEKLY"; flsaWeeklyOtLevel: "OT1" | "OT2"; flsaOtRateComputation: "BASE_PLUS_AVG_HALF" | "AVG_RATE" | "BASE_RATE" };

interface MealPremiumRow {
  applyFromMinutes: number;
  applyToMinutes: number;
  minimumMealMinutes: number;
  payMinutes: number;
  payCodeId: string | null;
  payLevel: string;
  inReferenceTime: string | null;
  waivePremium: boolean;
  unlessHoursExceed: boolean;
  unlessHoursExceedMinutes: number;
  unlessPunchedMeal: boolean;
}
type OtPreset = Pick<RSFields, "dailyOtMinutes" | "dailyDtMinutes" | "dailyDtMaxMinutes" | "weeklyOtEnabled" | "weeklyOtMinutes" | "weeklyDtMinutes" | "weeklyDtMaxMinutes" | "consecutiveDayOtEnabled" | "consecutiveDayOtDay" | "consecutiveDayPayCycleOnly" | "consecutiveDayOtMaxMinutes" | "consecutiveDayDtMaxMinutes">;
type RSTab = "general" | "overtime" | "rounding" | "guaranteed" | "miscellaneous" | "flsa";

const FEDERAL: OtPreset = { dailyOtMinutes: 1440, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 };

interface StateEntry { label: string; abbr: string; preset: OtPreset; rule: string }

const SPECIAL_STATES: StateEntry[] = [
  { label: "California", abbr: "CA", preset: { dailyOtMinutes: 480, dailyDtMinutes: 720, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: true,  consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 }, rule: "OT after 8h/day · DT after 12h/day · Weekly OT after 40h · 7th consecutive day" },
  { label: "Alaska",     abbr: "AK", preset: { dailyOtMinutes: 480, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 }, rule: "OT after 8h/day or 40h/week" },
  { label: "Nevada",     abbr: "NV", preset: { dailyOtMinutes: 480, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 }, rule: "OT after 8h/day (qualifying employees) or 40h/week" },
  { label: "Colorado",   abbr: "CO", preset: { dailyOtMinutes: 720, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 }, rule: "OT after 12h/day or 40h/week" },
  { label: "Puerto Rico", abbr: "PR", preset: { dailyOtMinutes: 480, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 }, rule: "OT after 8h/day or 40h/week" },
];

const FEDERAL_STATES = [
  "Alabama", "Arizona", "Arkansas", "Connecticut", "Delaware", "Florida",
  "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas",
  "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska",
  "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
  "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
  "District of Columbia",
];

function fmtMins(mins: number): string {
  if (mins >= 1440) return "disabled";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function parseForm(fd: FormData): RSFields {
  const payFreqRaw = fd.get("payFrequency") as string | null;
  const anchorRaw = fd.get("payPeriodAnchorDate") as string | null;
  return {
    name: fd.get("name") as string,
    number: fd.get("number") ? Number(fd.get("number")) : null,
    dailyOtMinutes: Number(fd.get("dailyOtMinutes")),
    dailyDtMinutes: Number(fd.get("dailyDtMinutes")),
    weeklyOtEnabled: fd.get("weeklyOtEnabled") === "true",
    weeklyOtMinutes: Number(fd.get("weeklyOtHours")) * 60,
    weeklyDtMinutes: Number(fd.get("weeklyDtMinutes")),
    dailyDtMaxMinutes: Number(fd.get("dailyDtMaxMinutes") ?? 0),
    weeklyDtMaxMinutes: Number(fd.get("weeklyDtMaxMinutes") ?? 0),
    consecutiveDayOtDay: Number(fd.get("consecutiveDayOtDay")),
    consecutiveDayPayCycleOnly: fd.get("consecutiveDayPayCycleOnly") === "true",
    consecutiveDayOtMaxMinutes: Number(fd.get("consecutiveDayOtMaxMinutes") ?? 0),
    consecutiveDayDtMaxMinutes: Number(fd.get("consecutiveDayDtMaxMinutes") ?? 0),
    pairRoundingEnabled: fd.get("pairRoundingEnabled") === "true",
    pairRoundingMinutes: Number(fd.get("pairRoundingMinutes") ?? 15),
    pairRoundingPoint: Number(fd.get("pairRoundingPoint") ?? 0),
    pairMinGuaranteedMinutes: Number(fd.get("pairMinGuaranteedMinutes") ?? 0),
    punchRoundingInEnabled: fd.get("punchRoundingInEnabled") === "true",
    punchRoundingInMinutes: Number(fd.get("punchRoundingInMinutes") ?? 15),
    punchRoundingInPoint: Number(fd.get("punchRoundingInPoint") ?? 0),
    punchRoundingInApplyToBreaks: fd.get("punchRoundingInApplyToBreaks") === "true",
    punchRoundingOutEnabled: fd.get("punchRoundingOutEnabled") === "true",
    punchRoundingOutMinutes: Number(fd.get("punchRoundingOutMinutes") ?? 15),
    punchRoundingOutPoint: Number(fd.get("punchRoundingOutPoint") ?? 0),
    punchRoundingOutApplyToBreaks: fd.get("punchRoundingOutApplyToBreaks") === "true",
    shiftRoundingEnabled: fd.get("shiftRoundingEnabled") === "true",
    shiftRoundingInWindow: Number(fd.get("shiftRoundingInWindow") ?? 0),
    shiftRoundingInGrace: Number(fd.get("shiftRoundingInGrace") ?? 0),
    shiftRoundingOutGrace: Number(fd.get("shiftRoundingOutGrace") ?? 0),
    shiftRoundingOutWindow: Number(fd.get("shiftRoundingOutWindow") ?? 0),
    mealBreakMinutes: Number(fd.get("mealBreakMinutes")),
    mealBreakAfterMinutes: Number(fd.get("mealBreakAfterHours")) * 60,
    autoDeductMeal: fd.get("autoDeductMeal") === "true",
    shortBreakMinutes: Number(fd.get("shortBreakMinutes")),
    shortBreaksPerDay: Number(fd.get("shortBreaksPerDay")),
    longShiftMinutes: Number(fd.get("longShiftHours")) * 60,
    isDefault: fd.get("isDefault") === "true",
    isActive: fd.get("isActive") !== "false",
    payFrequency: (payFreqRaw || null) as RSFields["payFrequency"],
    payPeriodAnchorDate: anchorRaw || null,
    defaultPayCodeId: (fd.get("defaultPayCodeId") as string | null) || null,
    autoPayEnabled: fd.get("autoPayEnabled") === "true",
    autoPayMode: ((fd.get("autoPayMode") as string) || "POLICY_HOURS") as AutoPayMode,
    autoPayDaySchedule: (() => { try { return JSON.parse(fd.get("autoPayDayScheduleJson") as string) || undefined; } catch { return undefined; } })(),
    autoPayPayCodeId: (fd.get("autoPayPayCodeId") as string | null) || null,
    autoPayOverflowThresholdMinutes: Number(fd.get("autoPayOverflowThresholdMinutes") ?? 0),
    autoPayOverflowPayCodeId: (fd.get("autoPayOverflowPayCodeId") as string | null) || null,
    mealBreakPremiumEnabled: fd.get("mealBreakPremiumEnabled") === "true",
    mealBreakPremiumMaxPerDay: Number(fd.get("mealBreakPremiumMaxPerDay") ?? 2),
    mealBreakPremiumResetEnabled: fd.get("mealBreakPremiumResetEnabled") === "true",
    mealBreakPremiumResetMinutes: Math.round(Number(fd.get("mealBreakPremiumResetHours") ?? 0) * 60),
    mealBreakPremiumWaivedMsgEnabled: fd.get("mealBreakPremiumWaivedMsgEnabled") === "true",
    mealBreakPremiumWaivedMsg: (fd.get("mealBreakPremiumWaivedMsg") as string | null) || null,
    mealPremiumUseActualForWindow: fd.get("mealPremiumUseActualForWindow") === "true",
    mealPremiumUseActualForMinimum: fd.get("mealPremiumUseActualForMinimum") === "true",
    mealPremiumLimitToPayMinutes: fd.get("mealPremiumLimitToPayMinutes") === "true",
    mealPremiumAllowTimesheetEdits: fd.get("mealPremiumAllowTimesheetEdits") === "true",
    mealPremiumUseTransferGroup: fd.get("mealPremiumUseTransferGroup") === "true",
    mealPremiumRows: [0, 1, 2, 3].map((i) => ({
      applyFromMinutes: Math.round(Number(fd.get(`mpr${i}From`) ?? 0) * 60),
      applyToMinutes: Math.round(Number(fd.get(`mpr${i}To`) ?? 0) * 60),
      minimumMealMinutes: Number(fd.get(`mpr${i}MinMeal`) ?? 0),
      payMinutes: Number(fd.get(`mpr${i}PayMins`) ?? 0),
      payCodeId: (fd.get(`mpr${i}PayCodeId`) as string | null) || null,
      payLevel: (fd.get(`mpr${i}PayLevel`) as string) || "REG",
      inReferenceTime: (fd.get(`mpr${i}RefTime`) as string | null) || null,
      waivePremium: fd.get(`mpr${i}Waive`) === "true",
      unlessHoursExceed: fd.get(`mpr${i}UnlessExceed`) === "true",
      unlessHoursExceedMinutes: Math.round(Number(fd.get(`mpr${i}UnlessHrs`) ?? 0) * 60),
      unlessPunchedMeal: fd.get(`mpr${i}UnlessPunched`) === "true",
    })),
    weekStartDay: Number(fd.get("weekStartDay") ?? 1),
    consecutiveDayOtEnabled: fd.get("consecutiveDayOtEnabled") === "true",
    otCycle: ((fd.get("otCycle") as string | null) || null) as OtCycle | null,
    otCycleDays: fd.get("otCycleDays") ? Number(fd.get("otCycleDays")) : null,
    otCycleAnchorDate: (fd.get("otCycleAnchorDate") as string | null) || null,
    otRateMultiplier: Math.round(Number(fd.get("otRateMultiplier") ?? 1.5) * 100),
    dtRateMultiplier: Math.round(Number(fd.get("dtRateMultiplier") ?? 2.0) * 100),
    overtimeRequiresAuth: fd.get("overtimeRequiresAuth") === "true",
    allowTimesheetOtAuth: fd.get("allowTimesheetOtAuth") === "true",
    otGraceBeforeShiftMinutes: Number(fd.get("otGraceBeforeShiftMinutes") ?? 0),
    otGraceAfterShiftMinutes: Number(fd.get("otGraceAfterShiftMinutes") ?? 0),
    flsaEnabled: fd.get("flsaEnabled") === "true",
    flsaType: (((fd.get("flsaType") as string) || "FEDERAL") as "FEDERAL" | "CALIFORNIA"),
    flsaDistributionFrequency: (((fd.get("flsaDistributionFrequency") as string) || "PER_PERIOD") as "PER_PERIOD" | "WEEKLY"),
    flsaAdjustmentPayCodeId: (fd.get("flsaAdjustmentPayCodeId") as string | null) || null,
    flsaAdjustmentInRefTime: (fd.get("flsaAdjustmentInRefTime") as string | null) || null,
    flsaAltPayCodeEnabled: fd.get("flsaAltPayCodeEnabled") === "true",
    flsaAltPayCodeId: (fd.get("flsaAltPayCodeId") as string | null) || null,
    flsaAltInRefTime: (fd.get("flsaAltInRefTime") as string | null) || null,
    flsaIncludePremiumHours: fd.get("flsaIncludePremiumHours") === "true",
    flsaIncludePayMatrixHours: fd.get("flsaIncludePayMatrixHours") === "true",
    flsaNoNegativeAdjustment: fd.get("flsaNoNegativeAdjustment") === "true",
    flsaUseTotalOtPremium: fd.get("flsaUseTotalOtPremium") === "true",
    flsaWeeklyOtPayMethod: fd.get("flsaWeeklyOtPayMethod") === "true",
    flsaMaxWeeklyRegularMinutes: Math.round(Number(fd.get("flsaMaxWeeklyRegularHours") ?? 40) * 60),
    flsaWeeklyOtLevel: (((fd.get("flsaWeeklyOtLevel") as string) || "OT1") as "OT1" | "OT2"),
    flsaApplyFullOtAmount: fd.get("flsaApplyFullOtAmount") === "true",
    flsaDistributeMultipleRecords: fd.get("flsaDistributeMultipleRecords") === "true",
    flsaOtRateComputation: (((fd.get("flsaOtRateComputation") as string) || "BASE_PLUS_AVG_HALF") as "BASE_PLUS_AVG_HALF" | "AVG_RATE" | "BASE_RATE"),
    flsaOtLevels: (() => { try { return JSON.parse(fd.get("flsaOtLevelsJson") as string) || []; } catch { return []; } })(),
    flsaIncludeAsRegular: (() => { try { return JSON.parse(fd.get("flsaIncludeAsRegularJson") as string) || []; } catch { return []; } })(),
    workdayExpansionEnabled: fd.get("workdayExpansionEnabled") === "true",
    workdayExpansionUseShiftDef: fd.get("workdayExpansionUseShiftDef") !== "false",
    workdayExpansionBeforeMinutes: Number(fd.get("workdayExpansionBeforeMinutes") ?? 0),
    workdayExpansionAfterMinutes: Number(fd.get("workdayExpansionAfterMinutes") ?? 120),
  };
}

function OtRow({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-36 shrink-0 text-xs text-zinc-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={0}
        className={`w-16 text-right ${smInputCls}`}
      />
      <span className="text-xs text-zinc-400">Hours</span>
      {hint && <span className="text-xs text-zinc-400 italic">{hint}</span>}
    </div>
  );
}

function HoursField({ name, label, defaultMinutes, min = 1 }: { name: string; label: string; defaultMinutes: number; min?: number }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-zinc-500">{label}</label>
      <div className="flex items-center gap-2">
        <input name={name} type="number" min={min} defaultValue={Math.round(defaultMinutes / 60)} className={`w-20 ${smInputCls}`} />
        <span className="text-xs text-zinc-400">h</span>
      </div>
    </div>
  );
}

function NumField({ name, label, defaultValue, unit, min = 0 }: { name: string; label: string; defaultValue: number; unit?: string; min?: number }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-zinc-500">{label}</label>
      <div className="flex items-center gap-2">
        <input name={name} type="number" min={min} defaultValue={defaultValue} className={`w-20 ${smInputCls}`} />
        {unit && <span className="text-xs text-zinc-400">{unit}</span>}
      </div>
    </div>
  );
}

function OtSectionHeader({ id, label, enabled, onToggle }: { id: string; label: string; enabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700 rounded-t-md">
      <input type="checkbox" id={id} checked={enabled} onChange={(e) => onToggle(e.target.checked)} className="h-4 w-4 cursor-pointer rounded" />
      <label htmlFor={id} className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">{label}</label>
    </div>
  );
}

function DailyOtSection({ defaultOtMinutes, defaultDtMinutes, defaultDtMaxMinutes }: {
  defaultOtMinutes: number; defaultDtMinutes: number; defaultDtMaxMinutes: number;
}) {
  const initEnabled = defaultOtMinutes < 1440;
  const [enabled, setEnabled] = useState(initEnabled);
  const [otHrs, setOtHrs] = useState(initEnabled ? Math.round(defaultOtMinutes / 60) : 8);
  const [dtHrs, setDtHrs] = useState(initEnabled ? Math.round(defaultDtMinutes / 60) : 12);
  const [dtMaxHrs, setDtMaxHrs] = useState(Math.round(defaultDtMaxMinutes / 60));
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
      <OtSectionHeader id="dailyOtEnabled" label="Daily" enabled={enabled} onToggle={setEnabled} />
      {enabled ? (
        <div className="divide-y divide-zinc-100 px-4 dark:divide-zinc-800/60">
          <OtRow label="OT Threshold" value={otHrs} onChange={setOtHrs} />
          <OtRow label="DT Threshold" value={dtHrs} onChange={setDtHrs} />
          <OtRow label="DT Max" value={dtMaxHrs} onChange={setDtMaxHrs} hint="(0 = no limit)" />
        </div>
      ) : (
        <p className="px-4 py-3 text-xs text-zinc-400">Disabled — no daily OT or DT rules applied</p>
      )}
      <input type="hidden" name="dailyOtMinutes" value={enabled ? otHrs * 60 : 1440} />
      <input type="hidden" name="dailyDtMinutes" value={enabled ? dtHrs * 60 : 1440} />
      <input type="hidden" name="dailyDtMaxMinutes" value={enabled ? dtMaxHrs * 60 : 0} />
    </div>
  );
}

function WeeklyOtSection({ defaultEnabled, defaultOtMinutes, defaultDtMinutes, defaultDtMaxMinutes }: {
  defaultEnabled: boolean; defaultOtMinutes: number; defaultDtMinutes: number; defaultDtMaxMinutes: number;
}) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [otHrs, setOtHrs] = useState(Math.round(defaultOtMinutes / 60));
  const initDtHrs = defaultDtMinutes >= 86400 ? 60 : Math.round(defaultDtMinutes / 60);
  const [dtHrs, setDtHrs] = useState(initDtHrs);
  const [dtMaxHrs, setDtMaxHrs] = useState(Math.round(defaultDtMaxMinutes / 60));
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
      <OtSectionHeader id="weeklyOtEnabled" label="Weekly / Cycle" enabled={enabled} onToggle={setEnabled} />
      {enabled ? (
        <div className="divide-y divide-zinc-100 px-4 dark:divide-zinc-800/60">
          <OtRow label="OT Threshold" value={otHrs} onChange={setOtHrs} />
          <OtRow label="DT Threshold" value={dtHrs} onChange={setDtHrs} />
          <OtRow label="DT Max" value={dtMaxHrs} onChange={setDtMaxHrs} hint="(0 = no limit)" />
        </div>
      ) : (
        <p className="px-4 py-3 text-xs text-zinc-400">Disabled — no weekly OT or DT rules applied</p>
      )}
      <input type="hidden" name="weeklyOtEnabled" value={enabled ? "true" : "false"} />
      <input type="hidden" name="weeklyOtHours" value={otHrs} />
      <input type="hidden" name="weeklyDtMinutes" value={enabled ? dtHrs * 60 : 86400} />
      <input type="hidden" name="weeklyDtMaxMinutes" value={enabled ? dtMaxHrs * 60 : 0} />
    </div>
  );
}

function ConsecutiveDaySection({ defaultEnabled, defaultDay, defaultPayCycleOnly, defaultOtMaxMinutes, defaultDtMaxMinutes }: {
  defaultEnabled: boolean; defaultDay: number; defaultPayCycleOnly: boolean; defaultOtMaxMinutes: number; defaultDtMaxMinutes: number;
}) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [day, setDay] = useState(defaultDay);
  const [payCycleOnly, setPayCycleOnly] = useState(defaultPayCycleOnly);
  const [otMaxHrs, setOtMaxHrs] = useState(Math.round(defaultOtMaxMinutes / 60));
  const [dtMaxHrs, setDtMaxHrs] = useState(Math.round(defaultDtMaxMinutes / 60));
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
      <OtSectionHeader id="consecutiveDayOtEnabled" label="Consecutive Day" enabled={enabled} onToggle={setEnabled} />
      {enabled ? (
        <div className="divide-y divide-zinc-100 px-4 dark:divide-zinc-800/60">
          <div className="flex items-center gap-3 py-2">
            <span className="w-36 shrink-0 text-xs text-zinc-500">OT starts on day</span>
            <input type="number" value={day} onChange={(e) => setDay(Number(e.target.value))} min={2} max={14} className={`w-16 text-right ${smInputCls}`} />
          </div>
          <div className="flex items-center gap-3 py-2.5">
            <span className="w-36 shrink-0 text-xs text-zinc-500">Pay cycle rule</span>
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" checked={payCycleOnly} onChange={(e) => setPayCycleOnly(e.target.checked)} className="h-4 w-4 rounded cursor-pointer" />
              All 7 days must be in a single pay cycle
            </label>
          </div>
          <OtRow label="Max OT" value={otMaxHrs} onChange={setOtMaxHrs} hint="(0 = no limit)" />
          <OtRow label="Max DT" value={dtMaxHrs} onChange={setDtMaxHrs} hint="(0 = no limit)" />
        </div>
      ) : (
        <p className="px-4 py-3 text-xs text-zinc-400">Disabled — no consecutive day OT applied</p>
      )}
      <input type="hidden" name="consecutiveDayOtEnabled" value={enabled ? "true" : "false"} />
      <input type="hidden" name="consecutiveDayOtDay" value={day} />
      <input type="hidden" name="consecutiveDayPayCycleOnly" value={payCycleOnly ? "true" : "false"} />
      <input type="hidden" name="consecutiveDayOtMaxMinutes" value={enabled ? otMaxHrs * 60 : 0} />
      <input type="hidden" name="consecutiveDayDtMaxMinutes" value={enabled ? dtMaxHrs * 60 : 0} />
    </div>
  );
}

function RateMultipliersSection({ defaultOt, defaultDt }: { defaultOt: number; defaultDt: number }) {
  const [otRate, setOtRate] = useState((defaultOt / 100).toFixed(4));
  const [dtRate, setDtRate] = useState((defaultDt / 100).toFixed(4));
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
      <div className="px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700 rounded-t-md">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Rate Multipliers</span>
      </div>
      <div className="divide-y divide-zinc-100 px-4 dark:divide-zinc-800/60">
        <div className="flex items-center gap-3 py-2">
          <span className="w-36 shrink-0 text-xs text-zinc-500">OT-1 (Overtime)</span>
          <input type="number" value={otRate} onChange={(e) => setOtRate(e.target.value)} step="0.25" min="1" max="10" className={`w-20 text-right ${smInputCls}`} />
          <span className="text-xs text-zinc-400">× rate</span>
        </div>
        <div className="flex items-center gap-3 py-2">
          <span className="w-36 shrink-0 text-xs text-zinc-500">OT-2 (Double time)</span>
          <input type="number" value={dtRate} onChange={(e) => setDtRate(e.target.value)} step="0.25" min="1" max="10" className={`w-20 text-right ${smInputCls}`} />
          <span className="text-xs text-zinc-400">× rate</span>
        </div>
      </div>
      <input type="hidden" name="otRateMultiplier" value={otRate} />
      <input type="hidden" name="dtRateMultiplier" value={dtRate} />
    </div>
  );
}

function AuthorizationSection({ defaultRequiresAuth, defaultAllowTimesheet, defaultGraceBefore, defaultGraceAfter }: {
  defaultRequiresAuth: boolean; defaultAllowTimesheet: boolean; defaultGraceBefore: number; defaultGraceAfter: number;
}) {
  const [requiresAuth, setRequiresAuth] = useState(defaultRequiresAuth);
  const [allowTimesheet, setAllowTimesheet] = useState(defaultAllowTimesheet);
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700 rounded-t-md">
        <input type="checkbox" id="overtimeRequiresAuth" checked={requiresAuth} onChange={(e) => setRequiresAuth(e.target.checked)} className="h-4 w-4 cursor-pointer rounded" />
        <label htmlFor="overtimeRequiresAuth" className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Authorization Required</label>
      </div>
      {requiresAuth ? (
        <div className="divide-y divide-zinc-100 px-4 dark:divide-zinc-800/60">
          <div className="flex items-center gap-3 py-2.5">
            <span className="w-36 shrink-0 text-xs text-zinc-500">Authorize at timesheet</span>
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" checked={allowTimesheet} onChange={(e) => setAllowTimesheet(e.target.checked)} className="h-4 w-4 rounded cursor-pointer" />
              Allow supervisors to authorize on the timecard
            </label>
          </div>
          <div className="flex items-center gap-3 py-2">
            <span className="w-36 shrink-0 text-xs text-zinc-500">Grace before shift</span>
            <input name="otGraceBeforeShiftMinutes" type="number" min={0} defaultValue={defaultGraceBefore} className={`w-16 text-right ${smInputCls}`} />
            <span className="text-xs text-zinc-400">min</span>
          </div>
          <div className="flex items-center gap-3 py-2">
            <span className="w-36 shrink-0 text-xs text-zinc-500">Grace after shift</span>
            <input name="otGraceAfterShiftMinutes" type="number" min={0} defaultValue={defaultGraceAfter} className={`w-16 text-right ${smInputCls}`} />
            <span className="text-xs text-zinc-400">min</span>
          </div>
        </div>
      ) : (
        <p className="px-4 py-3 text-xs text-zinc-400">Disabled — OT hours are counted without supervisor sign-off</p>
      )}
      <input type="hidden" name="overtimeRequiresAuth" value={requiresAuth ? "true" : "false"} />
      <input type="hidden" name="allowTimesheetOtAuth" value={allowTimesheet ? "true" : "false"} />
      {!requiresAuth && (
        <>
          <input type="hidden" name="otGraceBeforeShiftMinutes" value={0} />
          <input type="hidden" name="otGraceAfterShiftMinutes" value={0} />
        </>
      )}
    </div>
  );
}

function StatePresetPicker({ onChange }: { onChange: (p: OtPreset) => void }) {
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setValue(val);
    if (!val) { setHint(null); return; }
    const special = SPECIAL_STATES.find((s) => s.abbr === val);
    if (special) { setHint(special.rule); onChange(special.preset); }
    else { setHint("OT after 40h/week only (Federal FLSA)"); onChange(FEDERAL); }
  }
  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        State OT Preset <span className="font-normal text-zinc-400">(optional — pre-fills OT fields)</span>
      </label>
      <select value={value} onChange={handleChange} className={inputCls}>
        <option value="">— Choose a state —</option>
        <optgroup label="States with Daily OT Rules">
          {SPECIAL_STATES.map((s) => <option key={s.abbr} value={s.abbr}>{s.label} ({s.abbr})</option>)}
        </optgroup>
        <optgroup label="Federal FLSA — 40h/week OT only">
          {FEDERAL_STATES.map((n) => <option key={n} value={n}>{n}</option>)}
        </optgroup>
      </select>
      {hint && <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

function RuleSetFields({ rs, payCodes }: { rs?: RuleSet; payCodes: { id: string; code: number; label: string }[] }) {
  const [activeTab, setActiveTab] = useState<RSTab>("general");
  const [shiftRoundingEnabled, setShiftRoundingEnabled] = useState<boolean>(rs?.shiftRoundingEnabled ?? false);
  const [pairRoundingEnabled, setPairRoundingEnabled] = useState<boolean>(rs?.pairRoundingEnabled ?? false);
  const [punchRoundingInEnabled, setPunchRoundingInEnabled] = useState<boolean>(rs?.punchRoundingInEnabled ?? false);
  const [punchRoundingOutEnabled, setPunchRoundingOutEnabled] = useState<boolean>(rs?.punchRoundingOutEnabled ?? false);
  const [autoPayEnabled, setAutoPayEnabled] = useState<boolean>(rs?.autoPayEnabled ?? false);
  const [autoPayMode, setAutoPayMode] = useState<AutoPayMode>(rs?.autoPayMode ?? "POLICY_HOURS");
  type AutoPayDayRow = { day: number; apply: boolean; minutes: number };
  const DEFAULT_DAY_SCHEDULE: AutoPayDayRow[] = [0,1,2,3,4,5,6].map((d) => ({
    day: d, apply: d >= 1 && d <= 5, minutes: d >= 1 && d <= 5 ? 480 : 0,
  }));
  const [autoPayDaySchedule, setAutoPayDaySchedule] = useState<AutoPayDayRow[]>(() => {
    const stored = (rs as RuleSet & { autoPayDaySchedule?: AutoPayDayRow[] | null } | undefined)?.autoPayDaySchedule;
    if (Array.isArray(stored) && stored.length === 7) return stored as AutoPayDayRow[];
    return DEFAULT_DAY_SCHEDULE;
  });
  const [workdayExpansionEnabled, setWorkdayExpansionEnabled] = useState<boolean>(rs?.workdayExpansionEnabled ?? false);
  const [workdayExpansionUseShiftDef, setWorkdayExpansionUseShiftDef] = useState<boolean>(rs?.workdayExpansionUseShiftDef ?? true);
  const [mealBreakPremiumEnabled, setMealBreakPremiumEnabled] = useState<boolean>(rs?.mealBreakPremiumEnabled ?? false);
  const [mealBreakPremiumResetEnabled, setMealBreakPremiumResetEnabled] = useState<boolean>(rs?.mealBreakPremiumResetEnabled ?? false);
  const [mealBreakPremiumWaivedMsgEnabled, setMealBreakPremiumWaivedMsgEnabled] = useState<boolean>(rs?.mealBreakPremiumWaivedMsgEnabled ?? false);
  const [mealPremiumUseActualForWindow, setMealPremiumUseActualForWindow] = useState<boolean>(rs?.mealPremiumUseActualForWindow ?? true);
  const [mealPremiumUseActualForMinimum, setMealPremiumUseActualForMinimum] = useState<boolean>(rs?.mealPremiumUseActualForMinimum ?? true);
  const [mealPremiumLimitToPayMinutes, setMealPremiumLimitToPayMinutes] = useState<boolean>(rs?.mealPremiumLimitToPayMinutes ?? false);
  const [mealPremiumAllowTimesheetEdits, setMealPremiumAllowTimesheetEdits] = useState<boolean>(rs?.mealPremiumAllowTimesheetEdits ?? true);
  const [mealPremiumUseTransferGroup, setMealPremiumUseTransferGroup] = useState<boolean>(rs?.mealPremiumUseTransferGroup ?? false);
  const existingMealRows = (rs?.mealPremiumRows as MealPremiumRow[] | null) ?? [];
  const emptyRow: MealPremiumRow = { applyFromMinutes: 0, applyToMinutes: 0, minimumMealMinutes: 0, payMinutes: 0, payCodeId: null, payLevel: "REG", inReferenceTime: null, waivePremium: false, unlessHoursExceed: false, unlessHoursExceedMinutes: 0, unlessPunchedMeal: false };
  const [mealRowStates, setMealRowStates] = useState(() =>
    [0, 1, 2, 3].map((i) => {
      const r = existingMealRows[i] ?? emptyRow;
      return { waive: r.waivePremium, unlessExceed: r.unlessHoursExceed, unlessPunched: r.unlessPunchedMeal };
    })
  );
  function setMealRowCheck(i: number, key: "waive" | "unlessExceed" | "unlessPunched", val: boolean) {
    setMealRowStates((prev) => prev.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }
  const [otCycle, setOtCycle] = useState<string>(rs?.otCycle ?? "WEEKLY");
  const [otKey, setOtKey] = useState(0);
  const [otDefaults, setOtDefaults] = useState<OtPreset>({
    dailyOtMinutes: rs?.dailyOtMinutes ?? FEDERAL.dailyOtMinutes,
    dailyDtMinutes: rs?.dailyDtMinutes ?? FEDERAL.dailyDtMinutes,
    dailyDtMaxMinutes: rs?.dailyDtMaxMinutes ?? 0,
    weeklyOtEnabled: rs?.weeklyOtEnabled ?? true,
    weeklyOtMinutes: rs?.weeklyOtMinutes ?? FEDERAL.weeklyOtMinutes,
    weeklyDtMinutes: rs?.weeklyDtMinutes ?? 86400,
    weeklyDtMaxMinutes: rs?.weeklyDtMaxMinutes ?? 0,
    consecutiveDayOtEnabled: rs?.consecutiveDayOtEnabled ?? false,
    consecutiveDayOtDay: rs?.consecutiveDayOtDay ?? FEDERAL.consecutiveDayOtDay,
    consecutiveDayPayCycleOnly: rs?.consecutiveDayPayCycleOnly ?? true,
    consecutiveDayOtMaxMinutes: rs?.consecutiveDayOtMaxMinutes ?? 0,
    consecutiveDayDtMaxMinutes: rs?.consecutiveDayDtMaxMinutes ?? 0,
  });
  function applyPreset(preset: OtPreset) { setOtDefaults(preset); setOtKey((k) => k + 1); }

  const [flsaEnabled, setFlsaEnabled] = useState<boolean>(rs?.flsaEnabled ?? false);
  const [flsaAltPayCodeEnabled, setFlsaAltPayCodeEnabled] = useState<boolean>(rs?.flsaAltPayCodeEnabled ?? false);
  const [flsaWeeklyOtPayMethod, setFlsaWeeklyOtPayMethod] = useState<boolean>(rs?.flsaWeeklyOtPayMethod ?? false);
  const [flsaOtLevels, setFlsaOtLevels] = useState<string[]>(() =>
    Array.isArray(rs?.flsaOtLevels) ? (rs.flsaOtLevels as string[]) : []
  );
  const [flsaIncludeAsRegular, setFlsaIncludeAsRegular] = useState<string[]>(() =>
    Array.isArray(rs?.flsaIncludeAsRegular) ? (rs.flsaIncludeAsRegular as string[]) : []
  );

  const rsTabs: { id: RSTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "overtime", label: "Overtime" },
    { id: "rounding", label: "Rounding" },
    { id: "guaranteed", label: "Guaranteed Hours / Pay" },
    { id: "miscellaneous", label: "Miscellaneous" },
    { id: "flsa", label: "FLSA" },
  ];

  return (
    <div>
      {/* Tab nav */}
      <div className="mb-5 flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
        {rsTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === t.id
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-white dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* All panels stay in the DOM so form fields are always included in FormData */}

      {/* General tab */}
      <div className={activeTab !== "general" ? "hidden" : "space-y-4"}>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Rule Set Name</label>
          <input name="name" defaultValue={rs?.name} placeholder="e.g. California Hourly" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Pay Policy Number</label>
          <input
            name="number"
            type="number"
            min="1"
            step="1"
            defaultValue={rs?.number ?? ""}
            placeholder="e.g. 101"
            className={inputCls}
          />
          <p className="mt-1 text-xs text-zinc-400">Optional identifier used by external payroll systems.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Default rule set</label>
          <select name="isDefault" defaultValue={rs ? (rs.isDefault ? "true" : "false") : "false"} className={inputCls}>
            <option value="false">No</option>
            <option value="true">Yes — assign to new employees by default</option>
          </select>
        </div>
        {rs && (
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Status</label>
            <select name="isActive" defaultValue={rs.isActive ? "true" : "false"} className={inputCls}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-zinc-500">Default Pay Code</label>
          <select name="defaultPayCodeId" defaultValue={rs?.defaultPayCodeId ?? ""} className={inputCls}>
            <option value="">— None —</option>
            {payCodes.map((pc) => (
              <option key={pc.id} value={pc.id}>{pc.code} — {pc.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-400">
            Automatically assigned to new timecard rows created from punches and to salary daily credits.
          </p>
        </div>

        {/* Pay period configuration */}
        <div className="col-span-full mt-1 border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Pay Period Schedule</p>
          <p className="mb-3 text-xs text-zinc-500">
            Optional — configure a pay period schedule specific to this rule set.
            Leave blank to use the company-level schedule.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Pay Frequency</label>
          <select name="payFrequency" defaultValue={rs?.payFrequency ?? ""} className={inputCls}>
            <option value="">— Use company default —</option>
            {PAY_FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">
            Anchor Date{" "}
            <span className="font-normal text-zinc-400">(a known pay period start date)</span>
          </label>
          <input
            name="payPeriodAnchorDate"
            type="date"
            defaultValue={
              rs?.payPeriodAnchorDate
                ? new Date(rs.payPeriodAnchorDate).toISOString().slice(0, 10)
                : ""
            }
            className={inputCls}
          />
          <p className="mt-1 text-xs text-zinc-400">
            Required if pay frequency is set. Pick any valid pay period start date.
          </p>
        </div>

        {/* Overtime cycle */}
        <div className="col-span-full mt-1 border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Overtime Cycle</p>
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Workweek starts on</label>
              <select name="weekStartDay" defaultValue={rs?.weekStartDay ?? 1} className={`w-40 ${smInputCls}`}>
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
                <option value={2}>Tuesday</option>
                <option value={3}>Wednesday</option>
                <option value={4}>Thursday</option>
                <option value={5}>Friday</option>
                <option value={6}>Saturday</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Cycle</label>
              <select
                name="otCycle"
                value={otCycle}
                onChange={(e) => setOtCycle(e.target.value)}
                className={`w-40 ${smInputCls}`}
              >
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Bi-weekly</option>
                <option value="CUSTOM">Custom</option>
              </select>
            </div>
            {otCycle === "CUSTOM" && (
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Cycle length (days)</label>
                <input
                  name="otCycleDays"
                  type="number"
                  min={1}
                  defaultValue={rs?.otCycleDays ?? 14}
                  className={`w-24 ${smInputCls}`}
                />
              </div>
            )}
            {otCycle !== "WEEKLY" && (
              <div>
                <label className="mb-1 block text-xs text-zinc-500">
                  OT Reference Date{" "}
                  <span className="font-normal text-zinc-400">(cycle window anchor)</span>
                </label>
                <input
                  name="otCycleAnchorDate"
                  type="date"
                  defaultValue={
                    rs?.otCycleAnchorDate
                      ? new Date(rs.otCycleAnchorDate).toISOString().slice(0, 10)
                      : ""
                  }
                  className={smInputCls}
                />
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            {otCycle === "WEEKLY" && "OT resets each workweek, starting on the selected day above."}
            {otCycle === "BIWEEKLY" && "OT accumulates over 14-day windows anchored to the reference date."}
            {otCycle === "CUSTOM" && "OT accumulates over N-day windows anchored to the reference date."}
          </p>
        </div>
      </div>

      {/* Overtime tab */}
      <div className={activeTab !== "overtime" ? "hidden" : "space-y-4"}>
        <StatePresetPicker onChange={applyPreset} />
        <Fragment key={otKey}>
          <div className="space-y-3">
            <DailyOtSection
              defaultOtMinutes={otDefaults.dailyOtMinutes}
              defaultDtMinutes={otDefaults.dailyDtMinutes}
              defaultDtMaxMinutes={otDefaults.dailyDtMaxMinutes ?? 0}
            />
            <WeeklyOtSection
              defaultEnabled={otDefaults.weeklyOtEnabled ?? true}
              defaultOtMinutes={otDefaults.weeklyOtMinutes}
              defaultDtMinutes={otDefaults.weeklyDtMinutes ?? 86400}
              defaultDtMaxMinutes={otDefaults.weeklyDtMaxMinutes ?? 0}
            />
            <ConsecutiveDaySection
              defaultEnabled={otDefaults.consecutiveDayOtEnabled ?? false}
              defaultDay={otDefaults.consecutiveDayOtDay}
              defaultPayCycleOnly={otDefaults.consecutiveDayPayCycleOnly ?? true}
              defaultOtMaxMinutes={otDefaults.consecutiveDayOtMaxMinutes ?? 0}
              defaultDtMaxMinutes={otDefaults.consecutiveDayDtMaxMinutes ?? 0}
            />
            <RateMultipliersSection
              defaultOt={rs?.otRateMultiplier ?? 150}
              defaultDt={rs?.dtRateMultiplier ?? 200}
            />
            <AuthorizationSection
              defaultRequiresAuth={rs?.overtimeRequiresAuth ?? false}
              defaultAllowTimesheet={rs?.allowTimesheetOtAuth ?? true}
              defaultGraceBefore={rs?.otGraceBeforeShiftMinutes ?? 0}
              defaultGraceAfter={rs?.otGraceAfterShiftMinutes ?? 0}
            />
          </div>
        </Fragment>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-2">
          <HoursField name="longShiftHours" label="Flag shift as long after" defaultMinutes={rs?.longShiftMinutes ?? 720} />
        </div>
      </div>

      {/* Break fields preserved as hidden inputs — configured via shift, not rule set */}
      <input type="hidden" name="mealBreakMinutes" value={rs?.mealBreakMinutes ?? 30} />
      <input type="hidden" name="mealBreakAfterHours" value={(rs?.mealBreakAfterMinutes ?? 300) / 60} />
      <input type="hidden" name="autoDeductMeal" value={rs?.autoDeductMeal ? "true" : "false"} />
      <input type="hidden" name="shortBreakMinutes" value={rs?.shortBreakMinutes ?? 15} />
      <input type="hidden" name="shortBreaksPerDay" value={rs?.shortBreaksPerDay ?? 2} />

      {/* Rounding tab */}
      <div className={activeTab !== "rounding" ? "hidden" : "space-y-4"}>
        {/* Shift-aware rounding */}
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2.5 rounded-t-md border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/60">
            <input
              type="checkbox"
              id="shiftRoundingEnabled"
              checked={shiftRoundingEnabled}
              onChange={(e) => setShiftRoundingEnabled(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded"
            />
            <label htmlFor="shiftRoundingEnabled" className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
              Shift Time Rounding
            </label>
          </div>
          {/* A/B/C/D inputs stay in DOM even when hidden so FormData always includes them */}
          <div className={shiftRoundingEnabled ? "divide-y divide-zinc-100 px-4 dark:divide-zinc-800/60" : "hidden"}>
            <div className="py-3">
              <p className="mb-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">Clock-In</p>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="w-5 text-center text-xs font-bold text-zinc-400">A</span>
                  <span className="w-44 shrink-0 text-xs text-zinc-500">Before shift start</span>
                  <input name="shiftRoundingInWindow" type="number" min={0} defaultValue={rs?.shiftRoundingInWindow ?? 0} className={`w-16 text-right ${smInputCls}`} />
                  <span className="text-xs text-zinc-400">min → snaps to shift start</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-5 text-center text-xs font-bold text-zinc-400">B</span>
                  <span className="w-44 shrink-0 text-xs text-zinc-500">After shift start (grace)</span>
                  <input name="shiftRoundingInGrace" type="number" min={0} defaultValue={rs?.shiftRoundingInGrace ?? 0} className={`w-16 text-right ${smInputCls}`} />
                  <span className="text-xs text-zinc-400">min → snaps to shift start</span>
                </div>
              </div>
            </div>
            <div className="py-3">
              <p className="mb-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">Clock-Out</p>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="w-5 text-center text-xs font-bold text-zinc-400">C</span>
                  <span className="w-44 shrink-0 text-xs text-zinc-500">Before shift end (grace)</span>
                  <input name="shiftRoundingOutGrace" type="number" min={0} defaultValue={rs?.shiftRoundingOutGrace ?? 0} className={`w-16 text-right ${smInputCls}`} />
                  <span className="text-xs text-zinc-400">min → snaps to shift end</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-5 text-center text-xs font-bold text-zinc-400">D</span>
                  <span className="w-44 shrink-0 text-xs text-zinc-500">After shift end</span>
                  <input name="shiftRoundingOutWindow" type="number" min={0} defaultValue={rs?.shiftRoundingOutWindow ?? 0} className={`w-16 text-right ${smInputCls}`} />
                  <span className="text-xs text-zinc-400">min → snaps to shift end</span>
                </div>
              </div>
            </div>
          </div>
          {!shiftRoundingEnabled && (
            <p className="px-4 py-3 text-xs text-zinc-400">Disabled — punches are not snapped to shift boundaries</p>
          )}
          <input type="hidden" name="shiftRoundingEnabled" value={shiftRoundingEnabled ? "true" : "false"} />
        </div>

        {/* In / Out Rounding */}
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="rounded-t-md border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/60">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">In / Out Rounding</span>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {/* Clock-In */}
            <div className="px-4 py-3">
              <div className="mb-2.5 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="punchRoundingInEnabled"
                  checked={punchRoundingInEnabled}
                  onChange={(e) => setPunchRoundingInEnabled(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded"
                />
                <label htmlFor="punchRoundingInEnabled" className="cursor-pointer select-none text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Round punch-in time
                </label>
              </div>
              <div className={punchRoundingInEnabled ? "space-y-2 pl-6" : "hidden"}>
                <div className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs text-zinc-500">Increment</span>
                  <select name="punchRoundingInMinutes" defaultValue={rs?.punchRoundingInMinutes ?? 15} className={`w-44 ${smInputCls}`}>
                    <option value={6}>6 min (tenths)</option>
                    <option value={10}>10 min</option>
                    <option value={15}>15 min (quarters)</option>
                    <option value={20}>20 min (thirds)</option>
                    <option value={30}>30 min (halves)</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs text-zinc-500">Rounding point</span>
                  <input name="punchRoundingInPoint" type="number" min={0} defaultValue={rs?.punchRoundingInPoint ?? 0} className={`w-16 text-right ${smInputCls}`} />
                  <span className="text-xs text-zinc-400">min offset</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs text-zinc-500">Apply to breaks</span>
                  <select name="punchRoundingInApplyToBreaks" defaultValue={rs?.punchRoundingInApplyToBreaks ? "true" : "false"} className={`w-52 ${smInputCls}`}>
                    <option value="false">Clock-in only</option>
                    <option value="true">Clock-in + meal/break starts</option>
                  </select>
                </div>
              </div>
              <input type="hidden" name="punchRoundingInEnabled" value={punchRoundingInEnabled ? "true" : "false"} />
            </div>
            {/* Clock-Out */}
            <div className="px-4 py-3">
              <div className="mb-2.5 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="punchRoundingOutEnabled"
                  checked={punchRoundingOutEnabled}
                  onChange={(e) => setPunchRoundingOutEnabled(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded"
                />
                <label htmlFor="punchRoundingOutEnabled" className="cursor-pointer select-none text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Round punch-out time
                </label>
              </div>
              <div className={punchRoundingOutEnabled ? "space-y-2 pl-6" : "hidden"}>
                <div className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs text-zinc-500">Increment</span>
                  <select name="punchRoundingOutMinutes" defaultValue={rs?.punchRoundingOutMinutes ?? 15} className={`w-44 ${smInputCls}`}>
                    <option value={6}>6 min (tenths)</option>
                    <option value={10}>10 min</option>
                    <option value={15}>15 min (quarters)</option>
                    <option value={20}>20 min (thirds)</option>
                    <option value={30}>30 min (halves)</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs text-zinc-500">Rounding point</span>
                  <input name="punchRoundingOutPoint" type="number" min={0} defaultValue={rs?.punchRoundingOutPoint ?? 0} className={`w-16 text-right ${smInputCls}`} />
                  <span className="text-xs text-zinc-400">min offset</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs text-zinc-500">Apply to breaks</span>
                  <select name="punchRoundingOutApplyToBreaks" defaultValue={rs?.punchRoundingOutApplyToBreaks ? "true" : "false"} className={`w-52 ${smInputCls}`}>
                    <option value="false">Clock-out only</option>
                    <option value="true">Clock-out + meal/break ends</option>
                  </select>
                </div>
              </div>
              <input type="hidden" name="punchRoundingOutEnabled" value={punchRoundingOutEnabled ? "true" : "false"} />
            </div>
          </div>
        </div>

        {/* In / Out Pair Rounding */}
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2.5 rounded-t-md border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/60">
            <input
              type="checkbox"
              id="pairRoundingEnabled"
              checked={pairRoundingEnabled}
              onChange={(e) => setPairRoundingEnabled(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded"
            />
            <label htmlFor="pairRoundingEnabled" className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
              In / Out Pair Rounding
            </label>
          </div>
          <div className={pairRoundingEnabled ? "divide-y divide-zinc-100 px-4 dark:divide-zinc-800/60" : "hidden"}>
            <div className="flex items-center gap-3 py-2">
              <span className="w-44 shrink-0 text-xs text-zinc-500">Increment</span>
              <select name="pairRoundingMinutes" defaultValue={rs?.pairRoundingMinutes ?? 15} className={`w-44 ${smInputCls}`}>
                <option value={6}>6 min (tenths)</option>
                <option value={10}>10 min</option>
                <option value={15}>15 min (quarters)</option>
                <option value={20}>20 min (thirds)</option>
                <option value={30}>30 min (halves)</option>
              </select>
            </div>
            <div className="flex items-center gap-3 py-2">
              <span className="w-44 shrink-0 text-xs text-zinc-500">Rounding point</span>
              <input name="pairRoundingPoint" type="number" min={0} defaultValue={rs?.pairRoundingPoint ?? 0} className={`w-16 text-right ${smInputCls}`} />
              <span className="text-xs text-zinc-400">min offset</span>
            </div>
            <div className="flex items-center gap-3 py-2">
              <span className="w-44 shrink-0 text-xs text-zinc-500">Minimum guaranteed</span>
              <input name="pairMinGuaranteedMinutes" type="number" min={0} defaultValue={rs?.pairMinGuaranteedMinutes ?? 0} className={`w-16 text-right ${smInputCls}`} />
              <span className="text-xs text-zinc-400">min (0 = none)</span>
            </div>
          </div>
          {!pairRoundingEnabled && (
            <p className="px-4 py-3 text-xs text-zinc-400">Disabled — work duration is not rounded after punches are recorded</p>
          )}
          <input type="hidden" name="pairRoundingEnabled" value={pairRoundingEnabled ? "true" : "false"} />
        </div>
      </div>

      {/* Guaranteed Hours / Pay tab */}
      <div className={activeTab !== "guaranteed" ? "hidden" : "space-y-4"}>
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2.5 rounded-t-md border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/60">
            <input
              type="checkbox"
              id="autoPayEnabled"
              checked={autoPayEnabled}
              onChange={(e) => setAutoPayEnabled(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded"
            />
            <label htmlFor="autoPayEnabled" className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
              Apply Guaranteed Auto-Pay
            </label>
          </div>
          <div className={autoPayEnabled ? "divide-y divide-zinc-100 dark:divide-zinc-800/60" : "hidden"}>
            {/* Hours source */}
            <div className="px-4 py-3">
              <p className="mb-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">Hours Source</p>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2.5 text-xs text-zinc-600 dark:text-zinc-300">
                  <input
                    type="radio"
                    name="_autoPayModeRadio"
                    value="POLICY_HOURS"
                    checked={autoPayMode === "POLICY_HOURS"}
                    onChange={() => setAutoPayMode("POLICY_HOURS")}
                    className="h-4 w-4 cursor-pointer"
                  />
                  Policy Daily Hours
                </label>
                <label className="flex cursor-pointer items-center gap-2.5 text-xs text-zinc-600 dark:text-zinc-300">
                  <input
                    type="radio"
                    name="_autoPayModeRadio"
                    value="SHIFT_HOURS"
                    checked={autoPayMode === "SHIFT_HOURS"}
                    onChange={() => setAutoPayMode("SHIFT_HOURS")}
                    className="h-4 w-4 cursor-pointer"
                  />
                  Shift Hours <span className="ml-1 text-zinc-400">(uses employee&apos;s assigned shift duration)</span>
                </label>
              </div>
              <input type="hidden" name="autoPayMode" value={autoPayMode} />
            </div>

            {/* Per-day schedule — only for POLICY_HOURS */}
            <div className={autoPayMode === "POLICY_HOURS" ? "px-4 py-3" : "hidden"}>
              <p className="mb-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">Daily Schedule</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-400">
                    <th className="pb-1.5 font-normal">Day</th>
                    <th className="pb-1.5 font-normal text-center">Apply</th>
                    <th className="pb-1.5 font-normal text-right pr-1">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {autoPayDaySchedule.map((row, i) => {
                    const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][row.day];
                    return (
                      <tr key={row.day}>
                        <td className="py-1 text-zinc-600 dark:text-zinc-300">{dayName}</td>
                        <td className="py-1 text-center">
                          <input
                            type="checkbox"
                            checked={row.apply}
                            onChange={(e) => {
                              const next = [...autoPayDaySchedule];
                              next[i] = { ...row, apply: e.target.checked };
                              setAutoPayDaySchedule(next);
                            }}
                            className="h-4 w-4 cursor-pointer rounded"
                          />
                        </td>
                        <td className="py-1 text-right">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={row.minutes / 60}
                            onChange={(e) => {
                              const next = [...autoPayDaySchedule];
                              next[i] = { ...row, minutes: Math.round(parseFloat(e.target.value || "0") * 60) };
                              setAutoPayDaySchedule(next);
                            }}
                            disabled={!row.apply}
                            className={`w-16 text-right ${smInputCls} disabled:opacity-40`}
                          />
                          <span className="ml-1 text-zinc-400">h</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <input type="hidden" name="autoPayDayScheduleJson" value={JSON.stringify(autoPayDaySchedule)} />
            </div>

            {/* Auto-Pay pay code */}
            <div className="flex items-center gap-3 px-4 py-2">
              <span className="w-44 shrink-0 text-xs text-zinc-500">Auto-Pay Pay Code</span>
              <select name="autoPayPayCodeId" defaultValue={rs?.autoPayPayCodeId ?? ""} className={`w-52 ${smInputCls}`}>
                <option value="">— Use default pay code —</option>
                {payCodes.map((pc) => (
                  <option key={pc.id} value={pc.id}>{pc.code} — {pc.label}</option>
                ))}
              </select>
            </div>

            {/* Overflow */}
            <div className="px-4 py-3">
              <p className="mb-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">Overflow</p>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span>When auto-pay total exceeds</span>
                  <input
                    name="autoPayOverflowThresholdMinutes"
                    type="number"
                    min={0}
                    defaultValue={rs?.autoPayOverflowThresholdMinutes ?? 0}
                    className={`w-16 text-right ${smInputCls}`}
                  />
                  <span>min for the period — apply excess to:</span>
                </div>
                <div className="flex items-center gap-3 pl-0">
                  <span className="w-44 shrink-0 text-xs text-zinc-500">Overflow Pay Code</span>
                  <select name="autoPayOverflowPayCodeId" defaultValue={rs?.autoPayOverflowPayCodeId ?? ""} className={`w-52 ${smInputCls}`}>
                    <option value="">— None (0 min = disabled) —</option>
                    {payCodes.map((pc) => (
                      <option key={pc.id} value={pc.id}>{pc.code} — {pc.label}</option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-zinc-400">Set threshold to 0 or leave overflow pay code empty to disable overflow.</p>
              </div>
            </div>
          </div>
          {!autoPayEnabled && (
            <p className="px-4 py-3 text-xs text-zinc-400">Disabled — no automatic hours credited without punch activity</p>
          )}
          <input type="hidden" name="autoPayEnabled" value={autoPayEnabled ? "true" : "false"} />
        </div>
      </div>

      {/* Miscellaneous tab */}
      <div className={activeTab !== "miscellaneous" ? "hidden" : "space-y-4"}>

        {/* Expansion */}
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-start gap-2.5 rounded-t-md border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/60">
            <input
              type="checkbox"
              id="workdayExpansionEnabled"
              checked={workdayExpansionEnabled}
              onChange={(e) => setWorkdayExpansionEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded"
            />
            <label htmlFor="workdayExpansionEnabled" className="cursor-pointer select-none text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              <span className="font-semibold uppercase tracking-wider">Expansion</span>
              <br />
              <span className="font-normal text-zinc-500 dark:text-zinc-400">
                Extend the workday window before and after the scheduled shift so late clock-outs are correctly attributed to the right shift rather than split at midnight.
              </span>
            </label>
          </div>

          <div className={workdayExpansionEnabled ? "divide-y divide-zinc-100 dark:divide-zinc-800/60" : "hidden"}>
            {/* Use workday definition */}
            <div className="px-4 py-3">
              <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">Workday definition</p>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="workdayExpansionUseShiftDef"
                    value="true"
                    checked={workdayExpansionUseShiftDef}
                    onChange={() => setWorkdayExpansionUseShiftDef(true)}
                    className="h-4 w-4"
                  />
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Use workday definition (shift schedule)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="workdayExpansionUseShiftDef"
                    value="false"
                    checked={!workdayExpansionUseShiftDef}
                    onChange={() => setWorkdayExpansionUseShiftDef(false)}
                    className="h-4 w-4"
                  />
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Do NOT use workday definition (calendar day only)</span>
                </label>
              </div>
            </div>

            {/* Before / After minutes */}
            <div className="flex items-center gap-6 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="w-48 shrink-0 text-xs text-zinc-500">Before the start of a workday</span>
                <input
                  name="workdayExpansionBeforeMinutes"
                  type="number"
                  min={0}
                  max={480}
                  defaultValue={rs?.workdayExpansionBeforeMinutes ?? 0}
                  className={`w-16 text-right ${smInputCls}`}
                />
                <span className="text-xs text-zinc-400">min</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-44 shrink-0 text-xs text-zinc-500">After the end of a workday</span>
                <input
                  name="workdayExpansionAfterMinutes"
                  type="number"
                  min={0}
                  max={480}
                  defaultValue={rs?.workdayExpansionAfterMinutes ?? 120}
                  className={`w-16 text-right ${smInputCls}`}
                />
                <span className="text-xs text-zinc-400">min</span>
              </div>
            </div>
          </div>

          {!workdayExpansionEnabled && (
            <p className="px-4 py-3 text-xs text-zinc-400">Disabled — workday boundaries use calendar midnight</p>
          )}
          <input type="hidden" name="workdayExpansionEnabled" value={workdayExpansionEnabled ? "true" : "false"} />
          <input type="hidden" name="workdayExpansionUseShiftDef" value={workdayExpansionUseShiftDef ? "true" : "false"} />
        </div>

        {/* Meal / Break Premium Rules — master section */}
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-start gap-2.5 rounded-t-md border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/60">
            <input
              type="checkbox"
              id="mealBreakPremiumEnabled"
              checked={mealBreakPremiumEnabled}
              onChange={(e) => setMealBreakPremiumEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded"
            />
            <label htmlFor="mealBreakPremiumEnabled" className="cursor-pointer select-none text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              <span className="font-semibold uppercase tracking-wider">Meal / Break Premium Rules</span>
              <br />
              <span className="font-normal text-zinc-500 dark:text-zinc-400">
                Apply a premium when employees do not take the minimum required meal and/or paid break time and other qualifications are met.
              </span>
            </label>
          </div>

          <div className={mealBreakPremiumEnabled ? "divide-y divide-zinc-100 dark:divide-zinc-800/60" : "hidden"}>
            {/* Max premiums per day */}
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="w-64 shrink-0 text-xs text-zinc-500">Maximum premiums earned per day</span>
              <input name="mealBreakPremiumMaxPerDay" type="number" min={1} defaultValue={rs?.mealBreakPremiumMaxPerDay ?? 2} className={`w-16 text-right ${smInputCls}`} />
            </div>

            {/* Reset calculation */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  id="mealBreakPremiumResetEnabled"
                  checked={mealBreakPremiumResetEnabled}
                  onChange={(e) => setMealBreakPremiumResetEnabled(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded"
                />
                <label htmlFor="mealBreakPremiumResetEnabled" className="cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                  Reset premium calculation when employee has punched out for more than
                </label>
                <input name="mealBreakPremiumResetHours" type="number" min={0} step={0.5} defaultValue={rs ? rs.mealBreakPremiumResetMinutes / 60 : 0} className={`w-16 text-right ${smInputCls}`} />
                <span className="text-xs text-zinc-400">hours</span>
              </div>
              <p className="mt-1.5 pl-6 text-xs text-zinc-400">Premiums applied to previous hours still apply. Set to 0 or uncheck to disable.</p>
            </div>

            {/* Waived message */}
            <div className="px-4 py-3">
              <div className="mb-2 flex items-center gap-2.5">
                <input
                  type="checkbox"
                  id="mealBreakPremiumWaivedMsgEnabled"
                  checked={mealBreakPremiumWaivedMsgEnabled}
                  onChange={(e) => setMealBreakPremiumWaivedMsgEnabled(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded"
                />
                <label htmlFor="mealBreakPremiumWaivedMsgEnabled" className="cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                  Show waived meal / break premium message to employees
                </label>
              </div>
              <div className={mealBreakPremiumWaivedMsgEnabled ? "pl-6" : "hidden"}>
                <textarea name="mealBreakPremiumWaivedMsg" maxLength={250} rows={3} defaultValue={rs?.mealBreakPremiumWaivedMsg ?? ""} placeholder="Message shown to employees when a premium is waived…" className={`${inputCls} resize-none`} />
                <p className="mt-1 text-xs text-zinc-400">250 characters max</p>
              </div>
            </div>
          </div>

          {!mealBreakPremiumEnabled && (
            <p className="px-4 py-3 text-xs text-zinc-400">Disabled — no meal/break premium rules applied</p>
          )}
          <input type="hidden" name="mealBreakPremiumEnabled" value={mealBreakPremiumEnabled ? "true" : "false"} />
          <input type="hidden" name="mealBreakPremiumResetEnabled" value={mealBreakPremiumResetEnabled ? "true" : "false"} />
          <input type="hidden" name="mealBreakPremiumWaivedMsgEnabled" value={mealBreakPremiumWaivedMsgEnabled ? "true" : "false"} />
        </div>

        {/* Meal Premiums — detail config (visible only when premium enabled) */}
        <div className={mealBreakPremiumEnabled ? "rounded-md border border-zinc-200 dark:border-zinc-700" : "hidden"}>
          <div className="rounded-t-md border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/60">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Meal Premiums</span>
          </div>

          {/* Calculation options */}
          <div className="space-y-2 px-4 py-3">
            {([
              ["mealPremiumUseActualForWindow",  mealPremiumUseActualForWindow,  setMealPremiumUseActualForWindow,  "Calculate 'Apply Meal Premiums if no meal between' hours qualification based on actual (non-rounded) punch times"],
              ["mealPremiumUseActualForMinimum", mealPremiumUseActualForMinimum, setMealPremiumUseActualForMinimum, "Calculate 'Minimum Meal (in minutes)' qualification based on actual (non-rounded) punch times"],
              ["mealPremiumLimitToPayMinutes",   mealPremiumLimitToPayMinutes,   setMealPremiumLimitToPayMinutes,   "Limit paid Meal Premium minutes to the difference between 'Pay (in Minutes)' value and punches meal minutes"],
              ["mealPremiumAllowTimesheetEdits", mealPremiumAllowTimesheetEdits, setMealPremiumAllowTimesheetEdits, "Allow Meal Premium timesheet record edits"],
              ["mealPremiumUseTransferGroup",    mealPremiumUseTransferGroup,    setMealPremiumUseTransferGroup,    "Use transfer group values (e.g. job, department) for meal premium records"],
            ] as [string, boolean, (v: boolean) => void, string][]).map(([name, val, setter, label]) => (
              <label key={name} className="flex cursor-pointer items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-300">
                <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} className="mt-0.5 h-4 w-4 cursor-pointer rounded" />
                {label}
                <input type="hidden" name={name} value={val ? "true" : "false"} />
              </label>
            ))}
          </div>

          <p className="mx-4 mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-400">
            The Waive Premium option below also requires individual employee activation.
          </p>

          {/* Row table */}
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-max border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="py-2 pr-3 text-left font-medium text-zinc-500 whitespace-nowrap">Meal</th>
                  <th className="py-2 pr-3 text-center font-medium text-zinc-500 whitespace-nowrap" colSpan={3}>Apply if no meal between (hrs)</th>
                  <th className="py-2 pr-3 text-center font-medium text-zinc-500 whitespace-nowrap">Min Meal<br />(min)</th>
                  <th className="py-2 pr-3 text-center font-medium text-zinc-500 whitespace-nowrap">Pay<br />(min)</th>
                  <th className="py-2 pr-3 text-center font-medium text-zinc-500 whitespace-nowrap">Pay Code</th>
                  <th className="py-2 pr-3 text-center font-medium text-zinc-500 whitespace-nowrap">Pay Level</th>
                  <th className="py-2 pr-3 text-center font-medium text-zinc-500 whitespace-nowrap">Ref Time</th>
                  <th className="py-2 pr-3 text-center font-medium text-zinc-500 whitespace-nowrap">Waive</th>
                  <th className="py-2 pr-3 text-center font-medium text-zinc-500 whitespace-nowrap">Unless hrs exceed</th>
                  <th className="py-2 text-center font-medium text-zinc-500 whitespace-nowrap">Unless<br />Punched Meal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {(["First", "Second", "Third", "Fourth"] as const).map((label, i) => {
                  const r = existingMealRows[i] ?? emptyRow;
                  const rs2 = mealRowStates[i];
                  return (
                    <tr key={i}>
                      <td className="py-2 pr-3 font-medium text-zinc-500 whitespace-nowrap">{label}</td>
                      <td className="py-2 pr-1 text-center">
                        <input name={`mpr${i}From`} type="number" min={0} step={0.01} defaultValue={r.applyFromMinutes / 60 || ""} placeholder="0.00" className={`w-16 text-right ${smInputCls}`} />
                      </td>
                      <td className="py-2 px-1 text-center text-zinc-400">and</td>
                      <td className="py-2 pr-3 text-center">
                        <input name={`mpr${i}To`} type="number" min={0} step={0.01} defaultValue={r.applyToMinutes / 60 || ""} placeholder="0.00" className={`w-16 text-right ${smInputCls}`} />
                      </td>
                      <td className="py-2 pr-3 text-center">
                        <input name={`mpr${i}MinMeal`} type="number" min={0} defaultValue={r.minimumMealMinutes || ""} placeholder="0" className={`w-16 text-right ${smInputCls}`} />
                      </td>
                      <td className="py-2 pr-3 text-center">
                        <input name={`mpr${i}PayMins`} type="number" min={0} defaultValue={r.payMinutes || ""} placeholder="0" className={`w-16 text-right ${smInputCls}`} />
                      </td>
                      <td className="py-2 pr-3 text-center">
                        <select name={`mpr${i}PayCodeId`} defaultValue={r.payCodeId ?? ""} className={`w-32 ${smInputCls}`}>
                          <option value="">— None —</option>
                          {payCodes.map((pc) => (
                            <option key={pc.id} value={pc.id}>{pc.code} — {pc.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3 text-center">
                        <select name={`mpr${i}PayLevel`} defaultValue={r.payLevel || "REG"} className={`w-24 ${smInputCls}`}>
                          <option value="REG">Regular</option>
                          <option value="OT1">Overtime</option>
                          <option value="OT2">Double Time</option>
                          <option value="HOL">Holiday</option>
                        </select>
                      </td>
                      <td className="py-2 pr-3 text-center">
                        <input name={`mpr${i}RefTime`} type="time" defaultValue={r.inReferenceTime ?? ""} className={`w-24 ${smInputCls}`} />
                      </td>
                      <td className="py-2 pr-3 text-center">
                        <input type="checkbox" checked={rs2.waive} onChange={(e) => setMealRowCheck(i, "waive", e.target.checked)} className="h-4 w-4 cursor-pointer rounded" />
                        <input type="hidden" name={`mpr${i}Waive`} value={rs2.waive ? "true" : "false"} />
                      </td>
                      <td className="py-2 pr-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="checkbox" checked={rs2.unlessExceed} onChange={(e) => setMealRowCheck(i, "unlessExceed", e.target.checked)} className="h-4 w-4 cursor-pointer rounded" />
                          <input name={`mpr${i}UnlessHrs`} type="number" min={0} step={0.01} defaultValue={r.unlessHoursExceedMinutes / 60 || ""} placeholder="0.00" className={`w-16 text-right ${smInputCls}`} />
                        </div>
                        <input type="hidden" name={`mpr${i}UnlessExceed`} value={rs2.unlessExceed ? "true" : "false"} />
                      </td>
                      <td className="py-2 text-center">
                        <input type="checkbox" checked={rs2.unlessPunched} onChange={(e) => setMealRowCheck(i, "unlessPunched", e.target.checked)} className="h-4 w-4 cursor-pointer rounded" />
                        <input type="hidden" name={`mpr${i}UnlessPunched`} value={rs2.unlessPunched ? "true" : "false"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* FLSA tab */}
      <div className={activeTab !== "flsa" ? "hidden" : "space-y-4"}>
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-start gap-2.5 rounded-t-md border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/60">
            <input
              type="checkbox"
              id="flsaEnabled"
              checked={flsaEnabled}
              onChange={(e) => setFlsaEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded"
            />
            <label htmlFor="flsaEnabled" className="cursor-pointer select-none text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              <span className="font-semibold uppercase tracking-wider">Apply FLSA?</span>
              <br />
              <span className="font-normal text-zinc-500 dark:text-zinc-400">
                Enable Fair Labor Standards Act overtime calculation for employees on this rule set.
              </span>
            </label>
          </div>
          <input type="hidden" name="flsaEnabled" value={flsaEnabled ? "true" : "false"} />

          {!flsaEnabled && (
            <p className="px-4 py-3 text-xs text-zinc-400">Disabled — no FLSA adjustments applied</p>
          )}

          <div className={flsaEnabled ? "divide-y divide-zinc-100 dark:divide-zinc-800/60" : "hidden"}>
            {/* FLSA type */}
            <div className="px-4 py-3">
              <p className="mb-2 text-xs font-medium text-zinc-500">FLSA Type</p>
              <div className="flex gap-6">
                {(["FEDERAL", "CALIFORNIA"] as const).map((val) => (
                  <label key={val} className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="radio" name="flsaType" value={val} defaultChecked={(rs?.flsaType ?? "FEDERAL") === val} />
                    {val === "FEDERAL" ? "Federal FLSA" : "California FLSA"}
                  </label>
                ))}
              </div>
            </div>

            {/* Distribution frequency */}
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="w-56 shrink-0 text-xs text-zinc-500">FLSA OT Distribution Frequency</span>
              <select name="flsaDistributionFrequency" defaultValue={rs?.flsaDistributionFrequency ?? "PER_PERIOD"} className={`w-auto ${smInputCls}`}>
                <option value="PER_PERIOD">Once per Pay Period</option>
                <option value="WEEKLY">Weekly</option>
              </select>
            </div>

            {/* Adjustment pay code */}
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="w-56 shrink-0 text-xs text-zinc-500">FLSA Adjustment Pay Code</span>
              <select name="flsaAdjustmentPayCodeId" defaultValue={rs?.flsaAdjustmentPayCodeId ?? ""} className={`flex-1 ${smInputCls}`}>
                <option value="">— None —</option>
                {payCodes.map((pc) => (
                  <option key={pc.id} value={pc.id}>{pc.code} — {pc.label}</option>
                ))}
              </select>
              <span className="text-xs text-zinc-400">In Ref. Time</span>
              <input name="flsaAdjustmentInRefTime" type="time" defaultValue={rs?.flsaAdjustmentInRefTime ?? ""} className={`w-28 ${smInputCls}`} />
            </div>

            {/* Alt pay code for alternating weeks */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  id="flsaAltPayCodeEnabled"
                  checked={flsaAltPayCodeEnabled}
                  onChange={(e) => setFlsaAltPayCodeEnabled(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded"
                />
                <label htmlFor="flsaAltPayCodeEnabled" className="cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                  Use a different FLSA pay code for alternating weeks in the same pay period
                </label>
                <input type="hidden" name="flsaAltPayCodeEnabled" value={flsaAltPayCodeEnabled ? "true" : "false"} />
              </div>
              <div className={flsaAltPayCodeEnabled ? "mt-2 flex flex-wrap items-center gap-3 pl-6" : "hidden"}>
                <select name="flsaAltPayCodeId" defaultValue={rs?.flsaAltPayCodeId ?? ""} className={`flex-1 ${smInputCls}`}>
                  <option value="">— None —</option>
                  {payCodes.map((pc) => (
                    <option key={pc.id} value={pc.id}>{pc.code} — {pc.label}</option>
                  ))}
                </select>
                <span className="text-xs text-zinc-400">In Ref. Time</span>
                <input name="flsaAltInRefTime" type="time" defaultValue={rs?.flsaAltInRefTime ?? ""} className={`w-28 ${smInputCls}`} />
              </div>
            </div>

            {/* Boolean options */}
            <div className="space-y-2 px-4 py-3">
              {([
                ["flsaIncludePremiumHours",      "flsaIncludePremiumHours",      "Include Premium Hours?"],
                ["flsaIncludePayMatrixHours",    "flsaIncludePayMatrixHours",    "Include Pay Matrix Distribution Hours?"],
                ["flsaNoNegativeAdjustment",     "flsaNoNegativeAdjustment",     "Do not create a negative FLSA Adjustment Pay timesheet record"],
                ["flsaApplyFullOtAmount",        "flsaApplyFullOtAmount",        "Apply the full FLSA OT amount"],
                ["flsaDistributeMultipleRecords","flsaDistributeMultipleRecords","Distribute the computed FLSA adjustment amount to multiple records based on FLSA overtime timesheet groups"],
              ] as [string, keyof RuleSet, string][]).map(([id, key, label]) => (
                <label key={id} className="flex cursor-pointer items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-300">
                  <input type="checkbox" name={id} value="true" defaultChecked={(rs?.[key] as boolean) ?? false} className="mt-0.5 h-4 w-4 cursor-pointer rounded" />
                  {label}
                </label>
              ))}
            </div>

            {/* Use Total OT Premium */}
            <div className="px-4 py-3">
              <label className="flex cursor-pointer items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-300">
                <input type="checkbox" name="flsaUseTotalOtPremium" value="true" defaultChecked={rs?.flsaUseTotalOtPremium ?? false} className="mt-0.5 h-4 w-4 cursor-pointer rounded" />
                <span>
                  Use Total OT Premium Pay as FLSA Adjustment Pay amount in timesheet
                  <span className="block text-zinc-400">(OT-level Hours × (Rate multiplier − 1.00) × Avg. Rate)</span>
                </span>
              </label>
            </div>

            {/* FLSA Pay = Weekly OT pay - All Other OT pay */}
            <div className="px-4 py-3">
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="flsaWeeklyOtPayMethod"
                  checked={flsaWeeklyOtPayMethod}
                  onChange={(e) => setFlsaWeeklyOtPayMethod(e.target.checked)}
                  className="mt-0.5 h-4 w-4 cursor-pointer rounded"
                />
                <label htmlFor="flsaWeeklyOtPayMethod" className="cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                  FLSA Pay = Weekly OT pay − All Other OT pay
                  <span className="block text-zinc-400">Used when Weekly OT is not enabled</span>
                </label>
                <input type="hidden" name="flsaWeeklyOtPayMethod" value={flsaWeeklyOtPayMethod ? "true" : "false"} />
              </div>
              <div className={flsaWeeklyOtPayMethod ? "mt-2 flex items-center gap-3 pl-6" : "hidden"}>
                <span className="text-xs text-zinc-500">Maximum Weekly Regular Hours</span>
                <input name="flsaMaxWeeklyRegularHours" type="number" min={0} step={0.5} defaultValue={(rs?.flsaMaxWeeklyRegularMinutes ?? 2400) / 60} className={`w-16 text-right ${smInputCls}`} />
                <span className="text-xs text-zinc-400">hrs</span>
                <span className="ml-2 text-xs text-zinc-500">OT Level</span>
                <select name="flsaWeeklyOtLevel" defaultValue={rs?.flsaWeeklyOtLevel ?? "OT1"} className={`w-auto ${smInputCls}`}>
                  <option value="OT1">Overtime-1</option>
                  <option value="OT2">Overtime-2</option>
                </select>
              </div>
            </div>

            {/* OT rate computation */}
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="w-56 shrink-0 text-xs text-zinc-500">FLSA OT rate computation</span>
              <select name="flsaOtRateComputation" defaultValue={rs?.flsaOtRateComputation ?? "BASE_PLUS_AVG_HALF"} className={`w-auto ${smInputCls}`}>
                <option value="BASE_PLUS_AVG_HALF">Base Rate + (Average Rate / 2)</option>
                <option value="AVG_RATE">Average Rate</option>
                <option value="BASE_RATE">Base Rate</option>
              </select>
            </div>

            {/* O/T Level */}
            <div className="px-4 py-3">
              <p className="mb-2 text-xs font-medium text-zinc-500">O/T Level — OT tiers counted for FLSA calculation</p>
              <div className="flex flex-wrap gap-4">
                {(["OT1", "OT2"] as const).map((lvl) => (
                  <label key={lvl} className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={flsaOtLevels.includes(lvl)}
                      onChange={(e) => setFlsaOtLevels(e.target.checked ? [...flsaOtLevels, lvl] : flsaOtLevels.filter((l) => l !== lvl))}
                      className="h-4 w-4 cursor-pointer rounded"
                    />
                    {lvl === "OT1" ? "Overtime-1" : "Overtime-2"}
                  </label>
                ))}
              </div>
              <input type="hidden" name="flsaOtLevelsJson" value={JSON.stringify(flsaOtLevels)} />
            </div>

            {/* Include As Regular */}
            <div className="px-4 py-3">
              <p className="mb-2 text-xs font-medium text-zinc-500">Include As Regular — OT tiers treated as regular hours for FLSA</p>
              <div className="flex flex-wrap gap-4">
                {(["OT1", "OT2"] as const).map((lvl) => (
                  <label key={lvl} className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={flsaIncludeAsRegular.includes(lvl)}
                      onChange={(e) => setFlsaIncludeAsRegular(e.target.checked ? [...flsaIncludeAsRegular, lvl] : flsaIncludeAsRegular.filter((l) => l !== lvl))}
                      className="h-4 w-4 cursor-pointer rounded"
                    />
                    {lvl === "OT1" ? "Overtime-1" : "Overtime-2"}
                  </label>
                ))}
              </div>
              <input type="hidden" name="flsaIncludeAsRegularJson" value={JSON.stringify(flsaIncludeAsRegular)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
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
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close"
          >
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

export function RuleSetsManager({ ruleSets, payCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingRs, setEditingRs] = useState<RuleSet | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const searchLower = search.trim().toLowerCase();
  const visible = searchLower
    ? ruleSets.filter((rs) => rs.name.toLowerCase().includes(searchLower))
    : ruleSets;

  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createRuleSet(parseForm(new FormData(e.currentTarget)));
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleDelete(ruleSetId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteRuleSet({ ruleSetId });
      if (!result.success) { setError(result.error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      setEditingRs(null);
      router.refresh();
    });
  }

  function handleUpdate(ruleSetId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateRuleSet({ ruleSetId, ...parseForm(new FormData(e.currentTarget)) });
      if (!result.success) { setError(result.error); return; }
      setEditingRs(null);
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mb-3 flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search rule sets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-700 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500"
          />
        </div>
        <button
          onClick={openCreate}
          className="ml-auto rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Add Rule Set
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {visible.length === 0 && (
          <p className="text-sm text-zinc-400">
            {searchLower ? `No rule sets match "${search}".` : "No rule sets yet."}
          </p>
        )}
        {visible.map((rs) => (
          <button
            key={rs.id}
            type="button"
            onClick={() => { setEditingRs(rs); setConfirmDeleteId(null); setError(null); }}
            className="w-full rounded-xl border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`font-medium ${rs.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                  {rs.name}
                </span>
                {rs.isDefault && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    Default
                  </span>
                )}
                {!rs.isActive && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    Inactive
                  </span>
                )}
              </div>
              <span className="text-xs text-zinc-400">Click to edit →</span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Daily OT: {fmtMins(rs.dailyOtMinutes)} · Daily DT: {fmtMins(rs.dailyDtMinutes)} ·
              Weekly OT: {fmtMins(rs.weeklyOtMinutes)} · Consec day: day {rs.consecutiveDayOtDay}
            </p>
          </button>
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Rule Set" onClose={closeCreate}>
          {error && !editingRs && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
          )}
          <form onSubmit={handleCreate}>
            <RuleSetFields payCodes={payCodes} />
            <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
              <button type="button" onClick={closeCreate} className={cancelBtnCls}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editingRs && (
        <Modal title={`Edit: ${editingRs.name}`} onClose={() => { setEditingRs(null); setConfirmDeleteId(null); setError(null); }}>
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}
          <form onSubmit={(e) => handleUpdate(editingRs.id, e)}>
            <RuleSetFields rs={editingRs} payCodes={payCodes} />
            <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <div className="flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>
                  {isPending ? "Saving…" : "Save changes"}
                </button>
                <button type="button" onClick={() => { setEditingRs(null); setConfirmDeleteId(null); }} className={cancelBtnCls}>
                  Cancel
                </button>
              </div>
              {!editingRs.isDefault && (
                confirmDeleteId === editingRs.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">Are you sure?</span>
                    <button type="button" onClick={() => handleDelete(editingRs.id)} disabled={isPending} className={dangerBtnCls}>
                      {isPending ? "Deleting…" : "Yes, delete"}
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmDeleteId(editingRs.id)} className="text-xs text-red-500 hover:underline dark:text-red-400">
                    Delete rule set
                  </button>
                )
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
