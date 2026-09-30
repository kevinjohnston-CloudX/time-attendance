"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import type { AutoPayMode, OtCycle, RuleSet } from "@prisma/client";
import { createRuleSet, updateRuleSet, deleteRuleSet } from "@/actions/admin.actions";
import { Badge, Checkbox, Input, Select, Switch, Textarea } from "@/components/ui";
import { DeleteSection, EditorPage, Num, Row, Section, Tick, jumpToSection, words, type EditorGroup } from "./setup/editor-page";
import { ChoiceField, ClockField, DeleteAction, NotCalculated, StatusBadge, StatusField, saveError } from "./setup/setup-ui";

/**
 * Everything a rule set holds, and the page that edits it. The rule sets
 * list reads the pay frequency names from here.
 */

export const PAY_FREQUENCIES = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "SEMIMONTHLY", label: "Twice a month (1st to 15th, 16th to end)" },
  { value: "MONTHLY", label: "Monthly (1st to end of month)" },
] as const;

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

const FEDERAL: OtPreset = { dailyOtMinutes: 1440, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 };

interface StateEntry { label: string; abbr: string; preset: OtPreset; rule: string }

const SPECIAL_STATES: StateEntry[] = [
  { label: "California", abbr: "CA", preset: { dailyOtMinutes: 480, dailyDtMinutes: 720, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: true,  consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 }, rule: "Overtime after 8 h a day or 40 h a week, double time after 12 h a day, and the 7th day in a row." },
  { label: "Alaska",     abbr: "AK", preset: { dailyOtMinutes: 480, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 }, rule: "Overtime after 8 h a day or 40 h a week." },
  { label: "Nevada",     abbr: "NV", preset: { dailyOtMinutes: 480, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 }, rule: "Overtime after 8 h a day for qualifying employees, or 40 h a week." },
  { label: "Colorado",   abbr: "CO", preset: { dailyOtMinutes: 720, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 }, rule: "Overtime after 12 h a day or 40 h a week." },
  { label: "Puerto Rico", abbr: "PR", preset: { dailyOtMinutes: 480, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0, weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 86400, weeklyDtMaxMinutes: 0, consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true, consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0 }, rule: "Overtime after 8 h a day or 40 h a week." },
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


/* ── Small parts ──────────────────────────────────────────────────────── */

type PayCodeOption = { id: string; code: number; label: string; isActive?: boolean };
export type RuleSetRow = RuleSet & { _count?: { employees: number } };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const INCREMENTS = [
  { value: 6, label: "6 min (a tenth of an hour)" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min (a quarter hour)" },
  { value: 20, label: "20 min (a third of an hour)" },
  { value: 30, label: "30 min (a half hour)" },
];
const caption = { font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" } as const;
/** Stored minutes as hours, to 2 places: close enough that saving gives back the same minute. */
const hrs = (mins: number | null | undefined, fallback: number) => (mins == null ? fallback : Math.round((mins / 60) * 100) / 100);

/** A pay code picker: active codes, plus the one already chosen if it has been retired. */
function PayCodeSelect({
  name,
  defaultValue,
  payCodes,
  empty = "None",
  width = 280,
  ariaLabel,
}: {
  name: string;
  defaultValue: string | null | undefined;
  payCodes: PayCodeOption[];
  empty?: string;
  width?: number;
  ariaLabel: string;
}) {
  const list = payCodes.filter((p) => p.isActive !== false || p.id === defaultValue);
  return (
    <Select name={name} defaultValue={defaultValue ?? ""} aria-label={ariaLabel} style={{ width, maxWidth: "100%" }}>
      <option value="">{empty}</option>
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.code} {p.label}
          {p.isActive === false ? " (inactive)" : ""}
        </option>
      ))}
    </Select>
  );
}

/* ── The editor ───────────────────────────────────────────────────────── */


/**
 * The rule set editor, on a page of its own.
 *
 * <p>It used to be a window with seven tabs. Every section now sits on one
 * page, down the rail on the left, which says which ones are switched on, so
 * the whole rule set reads at a glance and a save never trips over a field
 * on a tab nobody opened. Save stays pinned in the header, and leaving with
 * changes not saved asks first.
 *
 * <p>Every field keeps the name the form reader above expects. Settings
 * that are saved but that no calculation reads yet say so, rather than
 * implying they change anybody's pay.
 */
export function RuleSetEditor({ ruleSet: rs, payCodes }: { ruleSet: RuleSetRow | null; payCodes: PayCodeOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const people = rs?._count?.employees ?? 0;

  /* Switched on or off, lifted here so the rail can say so. */
  const [dailyOn, setDailyOn] = useState((rs?.dailyOtMinutes ?? FEDERAL.dailyOtMinutes) < 1440);
  const [weeklyOn, setWeeklyOn] = useState(rs?.weeklyOtEnabled ?? true);
  const [consecOn, setConsecOn] = useState(rs?.consecutiveDayOtEnabled ?? false);
  const [authOn, setAuthOn] = useState(rs?.overtimeRequiresAuth ?? false);
  const [shiftRoundOn, setShiftRoundOn] = useState(rs?.shiftRoundingEnabled ?? false);
  const [punchInOn, setPunchInOn] = useState(rs?.punchRoundingInEnabled ?? false);
  const [punchOutOn, setPunchOutOn] = useState(rs?.punchRoundingOutEnabled ?? false);
  const [pairOn, setPairOn] = useState(rs?.pairRoundingEnabled ?? false);
  const [autoPayOn, setAutoPayOn] = useState(rs?.autoPayEnabled ?? false);
  const [expansionOn, setExpansionOn] = useState(rs?.workdayExpansionEnabled ?? false);
  const [premiumOn, setPremiumOn] = useState(rs?.mealBreakPremiumEnabled ?? false);
  const [flsaOn, setFlsaOn] = useState(rs?.flsaEnabled ?? false);

  /* Overtime values, which a state preset can refill. */
  const [presetKey, setPresetKey] = useState(0);
  const [ot, setOt] = useState<OtPreset>({
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
  function applyPreset(p: OtPreset) {
    setOt(p);
    setDailyOn(p.dailyOtMinutes < 1440);
    setWeeklyOn(p.weeklyOtEnabled);
    setConsecOn(p.consecutiveDayOtEnabled);
    setPresetKey((k) => k + 1);
  }

  const [payFrequency, setPayFrequency] = useState<string>(rs?.payFrequency ?? "");
  const [otCycle, setOtCycle] = useState<string>(rs?.otCycle ?? "WEEKLY");
  const [otAnchor, setOtAnchor] = useState(!!rs?.otCycleAnchorDate);
  const windowWords =
    otCycle === "WEEKLY" || !otAnchor ? "a week" : otCycle === "BIWEEKLY" ? "per 2 weeks" : "per overtime window";

  const sections: EditorGroup[] = [
    {
      title: "Basics",
      areas: [
        { id: "general", label: "General" },
        { id: "pay-period", label: "Pay period", count: payFrequency ? undefined : "Default" },
      ],
    },
    {
      title: "Overtime",
      areas: [
        { id: "ot-week", label: "Overtime week" },
        { id: "daily", label: "Daily overtime", count: dailyOn ? "On" : "Off" },
        { id: "weekly", label: "Weekly overtime", count: weeklyOn ? "On" : "Off" },
        { id: "consecutive", label: "Consecutive days", count: consecOn ? "On" : "Off" },
        { id: "approval", label: "Overtime approval", count: authOn ? "On" : "Off" },
        { id: "rates", label: "Overtime rates" },
      ],
    },
    {
      title: "Time",
      areas: [
        { id: "meals", label: "Meals and breaks" },
        { id: "shift-rounding", label: "Shift rounding", count: shiftRoundOn ? "On" : "Off" },
        { id: "punch-rounding", label: "Punch rounding", count: punchInOn || punchOutOn ? "On" : "Off" },
        { id: "pair-rounding", label: "Worked time rounding", count: pairOn ? "On" : "Off" },
      ],
    },
    {
      title: "Pay",
      areas: [
        { id: "guaranteed", label: "Guaranteed pay", count: autoPayOn ? "On" : "Off" },
        { id: "workday", label: "Workday window", count: expansionOn ? "On" : "Off" },
        { id: "premiums", label: "Meal premiums", count: premiumOn ? "On" : "Off" },
        { id: "flsa", label: "FLSA", count: flsaOn ? "On" : "Off" },
      ],
    },
  ];
  if (rs) sections.push({ title: "Other", areas: [{ id: "delete", label: "Delete rule set" }] });

  function onSubmit(form: HTMLFormElement) {
    const fields = parseForm(new FormData(form));
    if (!fields.name?.trim()) {
      jumpToSection("general");
      return setError("Give the rule set a name.");
    }
    if (fields.payFrequency && !fields.payPeriodAnchorDate) {
      jumpToSection("pay-period");
      return setError("Pick a day a pay period starts on, or set the pay frequency back to the company default.");
    }
    setError(null);
    startTransition(async () => {
      if (!rs) {
        const result = await createRuleSet(fields);
        if (!result.success) return setError(saveError(result.error));
        setSavedCount((n) => n + 1);
        router.replace(`/admin/rules-setup/rule-sets/${result.data.id}`);
        return;
      }
      const result = await updateRuleSet({ ruleSetId: rs.id, ...fields });
      if (!result.success) return setError(saveError(result.error));
      setSavedCount((n) => n + 1);
      router.refresh();
    });
  }

  function remove() {
    if (!rs) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteRuleSet({ ruleSetId: rs.id });
      if (!result.success) return setError(saveError(result.error));
      setSavedCount((n) => n + 1);
      router.push("/admin/rules-setup?tab=rule-sets");
    });
  }

  return (
    <EditorPage
      noun="rule set"
      title={rs ? rs.name : "New rule set"}
      subtitle={
        rs ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {rs.number != null && <span className="tabular">No. {rs.number}</span>}
            {rs.number != null && <span aria-hidden="true">·</span>}
            <span>
              {people.toLocaleString()} {people === 1 ? "employee" : "employees"}
            </span>
            {rs.isDefault && (
              <Badge tone="info" size="sm">
                Default
              </Badge>
            )}
            <StatusBadge active={rs.isActive} />
          </span>
        ) : (
          "Overtime, rounding and meal rules for a group of employees"
        )
      }
      back={{ href: "/admin/rules-setup?tab=rule-sets", label: "Rule sets" }}
      groups={sections}
      isNew={!rs}
      submitLabel={rs ? "Save changes" : "Add rule set"}
      pending={isPending}
      error={error}
      savedCount={savedCount}
      onSubmit={onSubmit}
    >
        {/* ── General ── */}
        <Section id="general" title="General" hint="What the rule set is called and the pay code its hours go to.">
          <Row label="Name">
            <span className="w-full max-w-[420px]">
              <Input name="name" required defaultValue={rs?.name ?? ""} placeholder="California hourly" aria-label="Name" />
            </span>
          </Row>
          <Row label="Payroll number" hint="Optional. The number an outside payroll system knows it by.">
            <Num name="number" min={1} step={1} defaultValue={rs?.number ?? ""} placeholder="101" aria-label="Payroll number" />
          </Row>
          <Row
            label="Default rule set"
            hint="Marks the company's main rule set, which cannot be deleted. New employees are not put on it automatically."
          >
            <ChoiceField
              label=""
              name="isDefault"
              defaultValue={rs?.isDefault ? "true" : "false"}
              options={[
                { value: "false", label: "No" },
                { value: "true", label: "Default" },
              ]}
            />
          </Row>
          {rs && (
            <Row label="Status" hint="An inactive rule set stays on the employees who have it.">
              <StatusField defaultActive={rs.isActive} bare />
            </Row>
          )}
          <Row label="Default pay code" hint="Put on new timecard lines made from punches, and on salary daily credits.">
            <PayCodeSelect name="defaultPayCodeId" defaultValue={rs?.defaultPayCodeId} payCodes={payCodes} ariaLabel="Default pay code" />
          </Row>
        </Section>

        {/* ── Pay period ── */}
        <Section
          id="pay-period"
          title="Pay period"
          hint="Optional. A pay schedule just for this rule set. Left on the company default, the company's schedule is used."
        >
          <Row label="Pay frequency">
            <Select
              name="payFrequency"
              value={payFrequency}
              onChange={(e) => setPayFrequency(e.target.value)}
              aria-label="Pay frequency"
              style={{ width: 320, maxWidth: "100%" }}
            >
              <option value="">Company default</option>
              {PAY_FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="A day a pay period starts on" hint="Needed when a pay frequency is set. Any start date, past or future, works.">
            <span style={{ width: 180 }}>
              <Input
                name="payPeriodAnchorDate"
                type="date"
                aria-label="A day a pay period starts on"
                defaultValue={rs?.payPeriodAnchorDate ? new Date(rs.payPeriodAnchorDate).toISOString().slice(0, 10) : ""}
              />
            </span>
          </Row>
        </Section>

        {/* ── Overtime week ── */}
        <Section id="ot-week" title="Overtime week" hint="When the week starts, and how long weekly overtime is counted over.">
          <Row label="Start from a state's rules" hint="Optional. Fills in daily, weekly and consecutive day overtime below.">
            <StatePresetPicker onChange={applyPreset} />
          </Row>
          <Row label="Workweek starts on">
            <Select name="weekStartDay" defaultValue={rs?.weekStartDay ?? 1} aria-label="Workweek starts on" style={{ width: 180 }}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
          </Row>
          <Row
            label="Weekly overtime is counted over"
            hint={
              otCycle === "WEEKLY"
                ? "Each workweek, starting on the day above."
                : otAnchor
                  ? otCycle === "BIWEEKLY"
                    ? "Two week windows, counted from the date below."
                    : "Windows of the length below, counted from the date below."
                  : "Without a start date below, it is counted by the workweek."
            }
          >
            <Select name="otCycle" value={otCycle} onChange={(e) => setOtCycle(e.target.value)} aria-label="Overtime cycle" style={{ width: 180 }}>
              <option value="WEEKLY">One week</option>
              <option value="BIWEEKLY">Two weeks</option>
              <option value="CUSTOM">A set number of days</option>
            </Select>
            {otCycle === "CUSTOM" && (
              <Num name="otCycleDays" min={1} defaultValue={rs?.otCycleDays ?? 14} unit="days" aria-label="Days in the window" />
            )}
          </Row>
          {otCycle !== "WEEKLY" && (
            <Row label="A day a window starts on">
              <span style={{ width: 180 }}>
                <Input
                  name="otCycleAnchorDate"
                  type="date"
                  aria-label="A day an overtime window starts on"
                  defaultValue={rs?.otCycleAnchorDate ? new Date(rs.otCycleAnchorDate).toISOString().slice(0, 10) : ""}
                  onChange={(e) => setOtAnchor(!!e.target.value)}
                />
              </span>
            </Row>
          )}
        </Section>

        <Fragment key={presetKey}>
          <DailySection on={dailyOn} onToggle={setDailyOn} preset={ot} />
          <WeeklySection on={weeklyOn} onToggle={setWeeklyOn} preset={ot} windowWords={windowWords} />
          <ConsecutiveSection on={consecOn} onToggle={setConsecOn} preset={ot} />
        </Fragment>

        {/* ── Approval ── */}
        <Section
          id="approval"
          title="Overtime approval"
          hint="Overtime waits for a supervisor to approve it before it is paid."
          on={authOn}
          onToggle={setAuthOn}
          offText="Off. Overtime is paid without anyone approving it."
        >
          <ApprovalRows rs={rs} on={authOn} />
        </Section>
        <input type="hidden" name="overtimeRequiresAuth" value={authOn ? "true" : "false"} />

        {/* ── Rates ── */}
        <Section id="rates" title="Overtime rates" hint="What overtime and double time pay, as a multiple of the regular rate." unused>
          <Row label="Overtime pays">
            <Num name="otRateMultiplier" min={1} max={10} step={0.25} defaultValue={(rs?.otRateMultiplier ?? 150) / 100} unit="× the regular rate" aria-label="Overtime rate" />
          </Row>
          <Row label="Double time pays">
            <Num name="dtRateMultiplier" min={1} max={10} step={0.25} defaultValue={(rs?.dtRateMultiplier ?? 200) / 100} unit="× the regular rate" aria-label="Double time rate" />
          </Row>
        </Section>

        {/* ── Meals and breaks ── */}
        <Section id="meals" title="Meals and breaks" hint="How long meals are, when one is due, and how it comes off the day.">
          <Row label="Meal length">
            <Num name="mealBreakMinutes" min={0} defaultValue={rs?.mealBreakMinutes ?? 30} unit="min" aria-label="Meal length" />
          </Row>
          <Row label="A meal is due after">
            <Num name="mealBreakAfterHours" min={0} step={0.25} defaultValue={hrs(rs?.mealBreakAfterMinutes, 5)} unit="hours of work" aria-label="A meal is due after" />
          </Row>
          <Row label="How meals come off" hint="Deducted automatically takes the meal off whether or not it was punched.">
            <ChoiceField
              label=""
              name="autoDeductMeal"
              defaultValue={rs?.autoDeductMeal ? "true" : "false"}
              options={[
                { value: "false", label: "Punched by the employee" },
                { value: "true", label: "Deducted automatically" },
              ]}
            />
          </Row>
          <Row label="Short break length" unused>
            <Num name="shortBreakMinutes" min={0} defaultValue={rs?.shortBreakMinutes ?? 15} unit="min" aria-label="Short break length" />
          </Row>
          <Row label="Short breaks a day" unused>
            <Num name="shortBreaksPerDay" min={0} defaultValue={rs?.shortBreaksPerDay ?? 2} aria-label="Short breaks a day" />
          </Row>
          <Row label="Flag a shift as long after" unused>
            <Num name="longShiftHours" min={1} step={0.25} defaultValue={hrs(rs?.longShiftMinutes, 12)} unit="hours" aria-label="Flag a shift as long after" />
          </Row>
        </Section>

        {/* ── Shift rounding ── */}
        <Section
          id="shift-rounding"
          title="Shift rounding"
          hint="Punches close to the scheduled start or end count as if they were on time."
          on={shiftRoundOn}
          onToggle={setShiftRoundOn}
          offText="Off. Punches are not moved to the shift's start or end."
        >
          <Row label="Early clock in" hint="Counts from the shift start.">
            <Num name="shiftRoundingInWindow" min={0} defaultValue={rs?.shiftRoundingInWindow ?? 0} unit="min or less before the start" aria-label="Early clock in, minutes" />
          </Row>
          <Row label="Late clock in" hint="Counts from the shift start.">
            <Num name="shiftRoundingInGrace" min={0} defaultValue={rs?.shiftRoundingInGrace ?? 0} unit="min or less after the start" aria-label="Late clock in, minutes" />
          </Row>
          <Row label="Early clock out" hint="Counts to the shift end.">
            <Num name="shiftRoundingOutGrace" min={0} defaultValue={rs?.shiftRoundingOutGrace ?? 0} unit="min or less before the end" aria-label="Early clock out, minutes" />
          </Row>
          <Row label="Late clock out" hint="Counts to the shift end.">
            <Num name="shiftRoundingOutWindow" min={0} defaultValue={rs?.shiftRoundingOutWindow ?? 0} unit="min or less after the end" aria-label="Late clock out, minutes" />
          </Row>
        </Section>
        <input type="hidden" name="shiftRoundingEnabled" value={shiftRoundOn ? "true" : "false"} />

        {/* ── Punch rounding ── */}
        <Section id="punch-rounding" title="Punch rounding" hint="Clock in and clock out times rounded to the nearest step.">
          <PunchRounding
            side="In"
            on={punchInOn}
            onToggle={setPunchInOn}
            minutes={rs?.punchRoundingInMinutes ?? 15}
            point={rs?.punchRoundingInPoint ?? 0}
            breaks={rs?.punchRoundingInApplyToBreaks ?? false}
          />
          <PunchRounding
            side="Out"
            on={punchOutOn}
            onToggle={setPunchOutOn}
            minutes={rs?.punchRoundingOutMinutes ?? 15}
            point={rs?.punchRoundingOutPoint ?? 0}
            breaks={rs?.punchRoundingOutApplyToBreaks ?? false}
          />
        </Section>

        {/* ── Pair rounding ── */}
        <Section
          id="pair-rounding"
          title="Worked time rounding"
          hint="The time between each clock in and clock out rounded to the nearest step, after punches are recorded."
          on={pairOn}
          onToggle={setPairOn}
          offText="Off. Worked time is not rounded."
        >
          <Row label="Round to the nearest">
            <IncrementSelect name="pairRoundingMinutes" defaultValue={rs?.pairRoundingMinutes ?? 15} />
          </Row>
          <Row label="Offset" hint="Shifts the steps. With 15 minute steps, an offset of 7 rounds to 7, 22, 37 and 52.">
            <Num name="pairRoundingPoint" min={0} defaultValue={rs?.pairRoundingPoint ?? 0} unit="min" aria-label="Worked time rounding offset" />
          </Row>
          <Row label="Least time paid" hint="0 means no minimum.">
            <Num name="pairMinGuaranteedMinutes" min={0} defaultValue={rs?.pairMinGuaranteedMinutes ?? 0} unit="min" aria-label="Least time paid" />
          </Row>
        </Section>
        <input type="hidden" name="pairRoundingEnabled" value={pairOn ? "true" : "false"} />

        <GuaranteedPay rs={rs} payCodes={payCodes} on={autoPayOn} onToggle={setAutoPayOn} />
        <WorkdayWindow rs={rs} on={expansionOn} onToggle={setExpansionOn} />
        <MealPremiums rs={rs} payCodes={payCodes} on={premiumOn} onToggle={setPremiumOn} />
        <Flsa rs={rs} payCodes={payCodes} on={flsaOn} onToggle={setFlsaOn} />

      {rs && (
        <DeleteSection
          title="Delete rule set"
          reason={
            rs.isDefault
              ? "The default rule set cannot be deleted."
              : people > 0
                ? `${people.toLocaleString()} ${people === 1 ? "employee is" : "employees are"} on it, so it cannot be deleted. Set it to inactive instead.`
                : "Nobody is on this rule set. Deleting it cannot be undone."
          }
        >
          {!rs.isDefault && people === 0 && (
            <DeleteAction label="Delete rule set" question="Delete this rule set for good?" pending={isPending} onDelete={remove} />
          )}
        </DeleteSection>
      )}
    </EditorPage>
  );
}

/* ── Overtime sections ────────────────────────────────────────────────── */

function DailySection({ on, onToggle, preset }: { on: boolean; onToggle: (v: boolean) => void; preset: OtPreset }) {
  const set = preset.dailyOtMinutes < 1440;
  const [otH, setOtH] = useState(set ? hrs(preset.dailyOtMinutes, 8) : 8);
  const [dtH, setDtH] = useState(set && preset.dailyDtMinutes < 1440 ? hrs(preset.dailyDtMinutes, 12) : 12);
  const [capH, setCapH] = useState(hrs(preset.dailyDtMaxMinutes, 0));
  return (
    <>
      <Section
        id="daily"
        title="Daily overtime"
        hint="Overtime and double time once a day passes a number of hours."
        on={on}
        onToggle={onToggle}
        offText="Off. No daily overtime or double time."
      >
        <Row label="Overtime after">
          <Num value={otH} onChange={(e) => setOtH(Number(e.target.value))} min={0} step={0.25} unit="hours a day" aria-label="Daily overtime after" />
        </Row>
        <Row label="Double time after">
          <Num value={dtH} onChange={(e) => setDtH(Number(e.target.value))} min={0} step={0.25} unit="hours a day" aria-label="Daily double time after" />
        </Row>
        <Row label="Most double time" hint="0 means no limit.">
          <Num value={capH} onChange={(e) => setCapH(Number(e.target.value))} min={0} step={0.25} unit="hours a day" aria-label="Most daily double time" />
        </Row>
      </Section>
      <input type="hidden" name="dailyOtMinutes" value={on ? Math.round(otH * 60) : 1440} />
      <input type="hidden" name="dailyDtMinutes" value={on ? Math.round(dtH * 60) : 1440} />
      <input type="hidden" name="dailyDtMaxMinutes" value={on ? Math.round(capH * 60) : 0} />
    </>
  );
}

function WeeklySection({
  on,
  onToggle,
  preset,
  windowWords,
}: {
  on: boolean;
  onToggle: (v: boolean) => void;
  preset: OtPreset;
  windowWords: string;
}) {
  const [otH, setOtH] = useState(hrs(preset.weeklyOtMinutes, 40));
  // 86400 minutes is how "no weekly double time" is stored.
  const [dtOn, setDtOn] = useState(preset.weeklyDtMinutes < 86400);
  const [dtH, setDtH] = useState(preset.weeklyDtMinutes < 86400 ? hrs(preset.weeklyDtMinutes, 60) : 60);
  const [capH, setCapH] = useState(hrs(preset.weeklyDtMaxMinutes, 0));
  return (
    <>
      <Section
        id="weekly"
        title="Weekly overtime"
        hint="Overtime once the week, or the overtime window, passes a number of hours."
        on={on}
        onToggle={onToggle}
        offText="Off. No weekly overtime or double time."
      >
        <Row label="Overtime after">
          <Num value={otH} onChange={(e) => setOtH(Number(e.target.value))} min={0} step={0.25} unit={`hours ${windowWords}`} aria-label="Weekly overtime after" />
        </Row>
        <Row label="Double time">
          <Tick checked={dtOn} onChange={setDtOn} label="Pay double time after" />
          {dtOn && (
            <Num value={dtH} onChange={(e) => setDtH(Number(e.target.value))} min={0} step={0.25} unit={`hours ${windowWords}`} aria-label="Weekly double time after" />
          )}
        </Row>
        {dtOn && (
          <Row label="Most double time" hint="0 means no limit.">
            <Num value={capH} onChange={(e) => setCapH(Number(e.target.value))} min={0} step={0.25} unit="hours" aria-label="Most weekly double time" />
          </Row>
        )}
      </Section>
      <input type="hidden" name="weeklyOtEnabled" value={on ? "true" : "false"} />
      <input type="hidden" name="weeklyOtHours" value={otH} />
      <input type="hidden" name="weeklyDtMinutes" value={on && dtOn ? Math.round(dtH * 60) : 86400} />
      <input type="hidden" name="weeklyDtMaxMinutes" value={on && dtOn ? Math.round(capH * 60) : 0} />
    </>
  );
}

function ConsecutiveSection({ on, onToggle, preset }: { on: boolean; onToggle: (v: boolean) => void; preset: OtPreset }) {
  const [day, setDay] = useState(preset.consecutiveDayOtDay);
  const [oneCycle, setOneCycle] = useState(preset.consecutiveDayPayCycleOnly);
  const [otCap, setOtCap] = useState(hrs(preset.consecutiveDayOtMaxMinutes, 0));
  const [dtCap, setDtCap] = useState(hrs(preset.consecutiveDayDtMaxMinutes, 0));
  return (
    <>
      <Section
        id="consecutive"
        title="Consecutive days"
        hint="Overtime for working several days in a row, such as the 7th day in California."
        on={on}
        onToggle={onToggle}
        offText="Off. Working many days in a row earns nothing extra."
      >
        <Row label="Premium starts on day" hint="The day in a row that is paid as overtime.">
          <Num value={day} onChange={(e) => setDay(Number(e.target.value))} min={2} max={14} unit="in a row" aria-label="Premium starts on day" />
        </Row>
        <Row label="Pay cycle">
          <Tick checked={oneCycle} onChange={setOneCycle} label={`All ${day} days must fall in one pay cycle`} />
        </Row>
        <Row label="Most overtime" hint="0 means no limit.">
          <Num value={otCap} onChange={(e) => setOtCap(Number(e.target.value))} min={0} step={0.25} unit="hours" aria-label="Most consecutive day overtime" />
        </Row>
        <Row label="Most double time" hint="0 means no limit.">
          <Num value={dtCap} onChange={(e) => setDtCap(Number(e.target.value))} min={0} step={0.25} unit="hours" aria-label="Most consecutive day double time" />
        </Row>
      </Section>
      <input type="hidden" name="consecutiveDayOtEnabled" value={on ? "true" : "false"} />
      <input type="hidden" name="consecutiveDayOtDay" value={day} />
      <input type="hidden" name="consecutiveDayPayCycleOnly" value={oneCycle ? "true" : "false"} />
      <input type="hidden" name="consecutiveDayOtMaxMinutes" value={on ? Math.round(otCap * 60) : 0} />
      <input type="hidden" name="consecutiveDayDtMaxMinutes" value={on ? Math.round(dtCap * 60) : 0} />
    </>
  );
}

function ApprovalRows({ rs, on }: { rs: RuleSetRow | null; on: boolean }) {
  const [onCard, setOnCard] = useState(rs?.allowTimesheetOtAuth ?? true);
  return (
    <>
      <Row label="On the timecard">
        <Tick name="allowTimesheetOtAuth" checked={onCard} onChange={setOnCard} label="Supervisors can approve overtime on the timecard" />
      </Row>
      {on ? (
        <>
          <Row label="Grace before the shift" hint="Time this close to the shift is not held for approval.">
            <Num name="otGraceBeforeShiftMinutes" min={0} defaultValue={rs?.otGraceBeforeShiftMinutes ?? 0} unit="min" aria-label="Grace before the shift" />
          </Row>
          <Row label="Grace after the shift" hint="Time this close to the shift is not held for approval.">
            <Num name="otGraceAfterShiftMinutes" min={0} defaultValue={rs?.otGraceAfterShiftMinutes ?? 0} unit="min" aria-label="Grace after the shift" />
          </Row>
        </>
      ) : (
        <>
          <input type="hidden" name="otGraceBeforeShiftMinutes" value={0} />
          <input type="hidden" name="otGraceAfterShiftMinutes" value={0} />
        </>
      )}
    </>
  );
}

function StatePresetPicker({ onChange }: { onChange: (p: OtPreset) => void }) {
  const [value, setValue] = useState("");
  const [rule, setRule] = useState<string | null>(null);
  return (
    <span className="flex w-full flex-col gap-1.5">
      <Select
        value={value}
        aria-label="Start from a state's rules"
        style={{ width: 320, maxWidth: "100%" }}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (!v) return setRule(null);
          const special = SPECIAL_STATES.find((s) => s.abbr === v);
          if (special) {
            setRule(special.rule);
            onChange(special.preset);
          } else {
            setRule("Overtime after 40 h a week only, the federal rule.");
            onChange(FEDERAL);
          }
        }}
      >
        <option value="">Choose a state</option>
        <optgroup label="States with daily overtime">
          {SPECIAL_STATES.map((s) => (
            <option key={s.abbr} value={s.abbr}>
              {s.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Federal rule only (40 h a week)">
          {FEDERAL_STATES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </optgroup>
      </Select>
      {rule && <span style={caption}>{rule} The fields below have been filled in. Nothing is saved until you save the rule set.</span>}
    </span>
  );
}

/* ── Rounding ─────────────────────────────────────────────────────────── */

function IncrementSelect({ name, defaultValue }: { name: string; defaultValue: number }) {
  return (
    <Select name={name} defaultValue={defaultValue} aria-label="Round to the nearest" style={{ width: 260, maxWidth: "100%" }}>
      {INCREMENTS.map((i) => (
        <option key={i.value} value={i.value}>
          {i.label}
        </option>
      ))}
    </Select>
  );
}

function PunchRounding({
  side,
  on,
  onToggle,
  minutes,
  point,
  breaks,
}: {
  side: "In" | "Out";
  on: boolean;
  onToggle: (v: boolean) => void;
  minutes: number;
  point: number;
  breaks: boolean;
}) {
  const word = side === "In" ? "clock in" : "clock out";
  return (
    <>
      <Row label={side === "In" ? "Clock in times" : "Clock out times"}>
        <Switch checked={on} onChange={onToggle} label={on ? `Rounded` : "Not rounded"} />
      </Row>
      <div hidden={!on} className="flex flex-col">
        <Row label="Round to the nearest">
          <IncrementSelect name={`punchRounding${side}Minutes`} defaultValue={minutes} />
        </Row>
        <Row label="Offset" hint="Shifts the steps. With 15 minute steps, an offset of 7 rounds to 7, 22, 37 and 52.">
          <Num name={`punchRounding${side}Point`} min={0} defaultValue={point} unit="min" aria-label={`Offset for ${word}`} />
        </Row>
        <Row label="Also round">
          <Select name={`punchRounding${side}ApplyToBreaks`} defaultValue={breaks ? "true" : "false"} aria-label={`What else ${word} rounding applies to`} style={{ width: 320, maxWidth: "100%" }}>
            <option value="false">{side === "In" ? "Clock in only" : "Clock out only"}</option>
            <option value="true">{side === "In" ? "Clock in, and meal and break starts" : "Clock out, and meal and break ends"}</option>
          </Select>
        </Row>
      </div>
      <input type="hidden" name={`punchRounding${side}Enabled`} value={on ? "true" : "false"} />
    </>
  );
}

/* ── Pay ──────────────────────────────────────────────────────────────── */

type AutoPayDayRow = { day: number; apply: boolean; minutes: number };

function GuaranteedPay({
  rs,
  payCodes,
  on,
  onToggle,
}: {
  rs: RuleSetRow | null;
  payCodes: PayCodeOption[];
  on: boolean;
  onToggle: (v: boolean) => void;
}) {
  const [mode, setMode] = useState<AutoPayMode>(rs?.autoPayMode ?? "POLICY_HOURS");
  const [days, setDays] = useState<AutoPayDayRow[]>(() => {
    const stored = (rs as (RuleSet & { autoPayDaySchedule?: AutoPayDayRow[] | null }) | null)?.autoPayDaySchedule;
    if (Array.isArray(stored) && stored.length === 7) return stored;
    return [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, apply: d >= 1 && d <= 5, minutes: d >= 1 && d <= 5 ? 480 : 0 }));
  });
  return (
    <>
      <Section
        id="guaranteed"
        title="Guaranteed pay"
        hint="Credits a set number of hours each day, with or without punches."
        on={on}
        onToggle={onToggle}
        offText="Off. Only punched time is paid."
      >
        <Row label="Hours come from">
          <ChoiceField
            label=""
            name="autoPayMode"
            defaultValue={mode}
            onChange={(v) => setMode(v as AutoPayMode)}
            options={[
              { value: "POLICY_HOURS", label: "The days below" },
              { value: "SHIFT_HOURS", label: "The employee's shift length" },
            ]}
          />
        </Row>
        <div hidden={mode !== "POLICY_HOURS"}>
          <Row label="Hours each day">
            <span className="flex w-full max-w-[420px] flex-col">
              {days.map((row, i) => (
                <span key={row.day} className="flex h-10 items-center gap-3">
                  <span className="w-[140px]">
                    <Checkbox
                      checked={row.apply}
                      onChange={(v) => setDays(days.map((d, j) => (j === i ? { ...d, apply: v } : d)))}
                      label={DAYS[row.day]}
                    />
                  </span>
                  <Num
                    value={row.minutes / 60}
                    onChange={(e) =>
                      setDays(days.map((d, j) => (j === i ? { ...d, minutes: Math.round(parseFloat(e.target.value || "0") * 60) } : d)))
                    }
                    disabled={!row.apply}
                    min={0}
                    step={0.5}
                    width={80}
                    unit="hours"
                    aria-label={`${DAYS[row.day]} hours`}
                  />
                </span>
              ))}
            </span>
            <input type="hidden" name="autoPayDayScheduleJson" value={JSON.stringify(days)} />
          </Row>
        </div>
        <Row label="Pay code">
          <PayCodeSelect name="autoPayPayCodeId" defaultValue={rs?.autoPayPayCodeId} payCodes={payCodes} empty="The default pay code" ariaLabel="Guaranteed pay code" />
        </Row>
        <Row label="Over the limit" hint="Hours past this in a pay period go to the second pay code. 0 or no pay code turns it off.">
          <Num name="autoPayOverflowThresholdMinutes" min={0} defaultValue={rs?.autoPayOverflowThresholdMinutes ?? 0} unit="min, then" aria-label="Guaranteed pay limit, minutes" />
          <PayCodeSelect name="autoPayOverflowPayCodeId" defaultValue={rs?.autoPayOverflowPayCodeId} payCodes={payCodes} ariaLabel="Pay code past the limit" width={240} />
        </Row>
      </Section>
      <input type="hidden" name="autoPayEnabled" value={on ? "true" : "false"} />
    </>
  );
}

function WorkdayWindow({ rs, on, onToggle }: { rs: RuleSetRow | null; on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <>
      <Section
        id="workday"
        title="Workday window"
        hint="Stretches the workday past the shift, so a late clock out stays on the right day instead of splitting at midnight."
        on={on}
        onToggle={onToggle}
        offText="Off. Each workday ends at midnight."
      >
        <Row label="The workday follows">
          <ChoiceField
            label=""
            name="workdayExpansionUseShiftDef"
            defaultValue={rs?.workdayExpansionUseShiftDef === false ? "false" : "true"}
            options={[
              { value: "true", label: "The shift schedule" },
              { value: "false", label: "The calendar day" },
            ]}
          />
        </Row>
        <Row label="Before the workday starts" unused>
          <Num name="workdayExpansionBeforeMinutes" min={0} max={480} defaultValue={rs?.workdayExpansionBeforeMinutes ?? 0} unit="min" aria-label="Before the workday starts" />
        </Row>
        <Row label="After the workday ends">
          <Num name="workdayExpansionAfterMinutes" min={0} max={480} defaultValue={rs?.workdayExpansionAfterMinutes ?? 120} unit="min" aria-label="After the workday ends" />
        </Row>
      </Section>
      <input type="hidden" name="workdayExpansionEnabled" value={on ? "true" : "false"} />
    </>
  );
}

const MEALS = ["First", "Second", "Third", "Fourth"] as const;

function MealPremiums({
  rs,
  payCodes,
  on,
  onToggle,
}: {
  rs: RuleSetRow | null;
  payCodes: PayCodeOption[];
  on: boolean;
  onToggle: (v: boolean) => void;
}) {
  const [resetOn, setResetOn] = useState(rs?.mealBreakPremiumResetEnabled ?? false);
  const [msgOn, setMsgOn] = useState(rs?.mealBreakPremiumWaivedMsgEnabled ?? false);
  const [actualWindow, setActualWindow] = useState(rs?.mealPremiumUseActualForWindow ?? true);
  const [actualMin, setActualMin] = useState(rs?.mealPremiumUseActualForMinimum ?? true);
  const [limitPay, setLimitPay] = useState(rs?.mealPremiumLimitToPayMinutes ?? false);
  const [edits, setEdits] = useState(rs?.mealPremiumAllowTimesheetEdits ?? true);
  const [transfer, setTransfer] = useState(rs?.mealPremiumUseTransferGroup ?? false);
  const stored = (rs?.mealPremiumRows as MealPremiumRow[] | null) ?? [];
  const empty: MealPremiumRow = {
    applyFromMinutes: 0,
    applyToMinutes: 0,
    minimumMealMinutes: 0,
    payMinutes: 0,
    payCodeId: null,
    payLevel: "REG",
    inReferenceTime: null,
    waivePremium: false,
    unlessHoursExceed: false,
    unlessHoursExceedMinutes: 0,
    unlessPunchedMeal: false,
  };
  const [ticks, setTicks] = useState(() =>
    MEALS.map((_, i) => {
      const r = stored[i] ?? empty;
      return { waive: r.waivePremium, exceed: r.unlessHoursExceed, punched: r.unlessPunchedMeal };
    }),
  );
  const tick = (i: number, k: "waive" | "exceed" | "punched", v: boolean) => setTicks(ticks.map((t, j) => (j === i ? { ...t, [k]: v } : t)));

  return (
    <>
      <Section
        id="premiums"
        title="Meal premiums"
        hint="Extra pay when someone does not get the meal they are owed. A meal below only pays once it has pay minutes and a pay code."
        on={on}
        onToggle={onToggle}
        offText="Off. A missed meal earns no premium."
      >
        <Row label="Most premiums a day">
          <Num name="mealBreakPremiumMaxPerDay" min={1} defaultValue={rs?.mealBreakPremiumMaxPerDay ?? 2} aria-label="Most premiums a day" />
        </Row>
        <Row label="How it is worked out">
          <span className="flex flex-col gap-2.5">
            <Tick name="mealPremiumUseActualForWindow" checked={actualWindow} onChange={setActualWindow} label="Use the actual punch times, not the rounded ones, for the meal window" />
            <Tick name="mealPremiumUseActualForMinimum" checked={actualMin} onChange={setActualMin} label="Use the actual punch times, not the rounded ones, for the shortest meal" />
            <Tick name="mealPremiumLimitToPayMinutes" checked={limitPay} onChange={setLimitPay} label="Pay only the premium minutes less the meal minutes that were punched" />
          </span>
        </Row>
        <Row label="Starting over" unused hint="Premiums already earned still apply.">
          <Tick name="mealBreakPremiumResetEnabled" checked={resetOn} onChange={setResetOn} label="Start counting again after a break of more than" />
          <Num name="mealBreakPremiumResetHours" min={0} step={0.5} defaultValue={hrs(rs?.mealBreakPremiumResetMinutes, 0)} width={80} unit="hours" aria-label="Start counting again after, hours" />
        </Row>
        <Row label="Timecard lines" unused>
          <span className="flex flex-col gap-2.5">
            <Tick name="mealPremiumAllowTimesheetEdits" checked={edits} onChange={setEdits} label="Premium lines can be edited on the timecard" />
            <Tick name="mealPremiumUseTransferGroup" checked={transfer} onChange={setTransfer} label="Premium lines carry the job or department someone transferred to" />
          </span>
        </Row>
        <Row label="Waived premium message" unused>
          <span className="flex w-full max-w-[520px] flex-col gap-2">
            <Tick name="mealBreakPremiumWaivedMsgEnabled" checked={msgOn} onChange={setMsgOn} label="Tell employees when a premium is waived" />
            <span hidden={!msgOn}>
              <Textarea
                name="mealBreakPremiumWaivedMsg"
                maxLength={250}
                rows={3}
                defaultValue={rs?.mealBreakPremiumWaivedMsg ?? ""}
                aria-label="Waived premium message"
                hint="Up to 250 characters."
              />
            </span>
          </span>
        </Row>

        {MEALS.map((label, i) => {
          const r = stored[i] ?? empty;
          const t = ticks[i];
          return (
            <Row key={label} label={`${label} meal`}>
              <span className="flex w-full flex-col gap-3">
                <span className="flex flex-wrap items-center gap-2" style={words}>
                  <span>A premium when there is no meal of at least</span>
                  <Num name={`mpr${i}MinMeal`} min={0} width={72} defaultValue={r.minimumMealMinutes || ""} placeholder="0" aria-label={`${label} meal, shortest meal minutes`} />
                  <span>min between hour</span>
                  <Num name={`mpr${i}From`} min={0} step={0.01} width={80} defaultValue={r.applyFromMinutes ? hrs(r.applyFromMinutes, 0) : ""} placeholder="0" aria-label={`${label} meal, window starts at hour`} />
                  <span>and hour</span>
                  <Num name={`mpr${i}To`} min={0} step={0.01} width={80} defaultValue={r.applyToMinutes ? hrs(r.applyToMinutes, 0) : ""} placeholder="0" aria-label={`${label} meal, window ends at hour`} />
                  <span>of the shift.</span>
                </span>
                <span className="flex flex-wrap items-center gap-2" style={words}>
                  <span>It pays</span>
                  <Num name={`mpr${i}PayMins`} min={0} width={72} defaultValue={r.payMinutes || ""} placeholder="0" aria-label={`${label} meal, premium minutes`} />
                  <span>min on</span>
                  <PayCodeSelect name={`mpr${i}PayCodeId`} defaultValue={r.payCodeId} payCodes={payCodes} ariaLabel={`${label} meal, premium pay code`} width={240} />
                </span>
                <span className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
                  <span className="inline-flex items-center gap-2">
                    <Tick checked={t.exceed} onChange={(v) => tick(i, "exceed", v)} label="Not when hours worked are over" />
                    <input type="hidden" name={`mpr${i}UnlessExceed`} value={t.exceed ? "true" : "false"} />
                    <Num name={`mpr${i}UnlessHrs`} min={0} step={0.01} width={80} defaultValue={r.unlessHoursExceedMinutes ? hrs(r.unlessHoursExceedMinutes, 0) : ""} placeholder="0" unit="hours" aria-label={`${label} meal, not when hours are over`} />
                  </span>
                  <Tick checked={t.punched} onChange={(v) => tick(i, "punched", v)} label="Only a punched meal counts" />
                  <input type="hidden" name={`mpr${i}UnlessPunched`} value={t.punched ? "true" : "false"} />
                </span>
                <span className="flex flex-wrap items-center gap-x-5 gap-y-2.5" style={words}>
                  <span className="inline-flex items-center gap-2">
                    <span>Paid as</span>
                    <Select name={`mpr${i}PayLevel`} defaultValue={r.payLevel || "REG"} aria-label={`${label} meal, paid as`} style={{ width: 150 }}>
                      <option value="REG">Regular</option>
                      <option value="OT1">Overtime</option>
                      <option value="OT2">Double time</option>
                      <option value="HOL">Holiday</option>
                    </Select>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span>Recorded at</span>
                    <ClockField name={`mpr${i}RefTime`} defaultValue={r.inReferenceTime} label={`${label} meal, recorded at`} />
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Tick checked={t.waive} onChange={(v) => tick(i, "waive", v)} label="Can be waived" />
                    <input type="hidden" name={`mpr${i}Waive`} value={t.waive ? "true" : "false"} />
                  </span>
                  <NotCalculated />
                </span>
              </span>
            </Row>
          );
        })}
      </Section>
      <input type="hidden" name="mealBreakPremiumEnabled" value={on ? "true" : "false"} />
    </>
  );
}

function Flsa({
  rs,
  payCodes,
  on,
  onToggle,
}: {
  rs: RuleSetRow | null;
  payCodes: PayCodeOption[];
  on: boolean;
  onToggle: (v: boolean) => void;
}) {
  const [alt, setAlt] = useState(rs?.flsaAltPayCodeEnabled ?? false);
  const [weeklyMethod, setWeeklyMethod] = useState(rs?.flsaWeeklyOtPayMethod ?? false);
  const [premium, setPremium] = useState(rs?.flsaIncludePremiumHours ?? false);
  const [matrix, setMatrix] = useState(rs?.flsaIncludePayMatrixHours ?? false);
  const [noNegative, setNoNegative] = useState(rs?.flsaNoNegativeAdjustment ?? false);
  const [fullOt, setFullOt] = useState(rs?.flsaApplyFullOtAmount ?? false);
  const [distribute, setDistribute] = useState(rs?.flsaDistributeMultipleRecords ?? false);
  const [totalPremium, setTotalPremium] = useState(rs?.flsaUseTotalOtPremium ?? false);
  const [levels, setLevels] = useState<string[]>(() => (Array.isArray(rs?.flsaOtLevels) ? (rs.flsaOtLevels as string[]) : []));
  const [asRegular, setAsRegular] = useState<string[]>(() =>
    Array.isArray(rs?.flsaIncludeAsRegular) ? (rs.flsaIncludeAsRegular as string[]) : [],
  );
  const toggle = (list: string[], v: string, on: boolean) => (on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v));
  const LEVELS = [
    { value: "OT1", label: "Overtime" },
    { value: "OT2", label: "Double time" },
  ];
  return (
    <>
      <Section
        id="flsa"
        title="FLSA"
        hint="The Fair Labor Standards Act adjustment to overtime pay for people on this rule set."
        on={on}
        onToggle={onToggle}
        offText="Off. No FLSA adjustment."
        unused
      >
        <Row label="Rules to follow">
          <ChoiceField
            label=""
            name="flsaType"
            defaultValue={rs?.flsaType ?? "FEDERAL"}
            options={[
              { value: "FEDERAL", label: "Federal" },
              { value: "CALIFORNIA", label: "California" },
            ]}
          />
        </Row>
        <Row label="Worked out">
          <Select name="flsaDistributionFrequency" defaultValue={rs?.flsaDistributionFrequency ?? "PER_PERIOD"} aria-label="How often FLSA is worked out" style={{ width: 220 }}>
            <option value="PER_PERIOD">Once a pay period</option>
            <option value="WEEKLY">Every week</option>
          </Select>
        </Row>
        <Row label="Adjustment pay code">
          <PayCodeSelect name="flsaAdjustmentPayCodeId" defaultValue={rs?.flsaAdjustmentPayCodeId} payCodes={payCodes} ariaLabel="FLSA adjustment pay code" width={260} />
          <span style={words}>recorded at</span>
          <ClockField name="flsaAdjustmentInRefTime" defaultValue={rs?.flsaAdjustmentInRefTime} label="FLSA adjustment recorded at" />
        </Row>
        <Row label="Alternating weeks">
          <span className="flex flex-col gap-2.5">
            <Tick name="flsaAltPayCodeEnabled" checked={alt} onChange={setAlt} label="Use another pay code on alternating weeks of the same pay period" />
            <span hidden={!alt} className="flex flex-wrap items-center gap-2">
              <PayCodeSelect name="flsaAltPayCodeId" defaultValue={rs?.flsaAltPayCodeId} payCodes={payCodes} ariaLabel="Alternating week pay code" width={260} />
              <span style={words}>recorded at</span>
              <ClockField name="flsaAltInRefTime" defaultValue={rs?.flsaAltInRefTime} label="Alternating week recorded at" />
            </span>
          </span>
        </Row>
        <Row label="Include">
          <span className="flex flex-col gap-2.5">
            <Tick name="flsaIncludePremiumHours" checked={premium} onChange={setPremium} label="Premium hours" />
            <Tick name="flsaIncludePayMatrixHours" checked={matrix} onChange={setMatrix} label="Pay matrix hours" />
          </span>
        </Row>
        <Row label="The adjustment">
          <span className="flex flex-col gap-2.5">
            <Tick name="flsaNoNegativeAdjustment" checked={noNegative} onChange={setNoNegative} label="Never record a negative adjustment" />
            <Tick name="flsaApplyFullOtAmount" checked={fullOt} onChange={setFullOt} label="Apply the full FLSA overtime amount" />
            <Tick name="flsaDistributeMultipleRecords" checked={distribute} onChange={setDistribute} label="Split it across timecard lines by overtime group" />
            <Tick
              name="flsaUseTotalOtPremium"
              checked={totalPremium}
              onChange={setTotalPremium}
              label="Use the total overtime premium as the adjustment (overtime hours × (rate multiple less 1) × average rate)"
            />
          </span>
        </Row>
        <Row label="Weekly overtime method" hint="For rule sets without weekly overtime.">
          <span className="flex flex-col gap-2.5">
            <Tick name="flsaWeeklyOtPayMethod" checked={weeklyMethod} onChange={setWeeklyMethod} label="FLSA pay is weekly overtime pay less all other overtime pay" />
            <span hidden={!weeklyMethod} className="flex flex-wrap items-center gap-2" style={words}>
              <span>Most regular hours a week</span>
              <Num name="flsaMaxWeeklyRegularHours" min={0} step={0.5} width={80} defaultValue={hrs(rs?.flsaMaxWeeklyRegularMinutes, 40)} aria-label="Most regular hours a week" />
              <span>then paid as</span>
              <Select name="flsaWeeklyOtLevel" defaultValue={rs?.flsaWeeklyOtLevel ?? "OT1"} aria-label="Paid as" style={{ width: 160 }}>
                <option value="OT1">Overtime</option>
                <option value="OT2">Double time</option>
              </Select>
            </span>
          </span>
        </Row>
        <Row label="Overtime rate">
          <Select name="flsaOtRateComputation" defaultValue={rs?.flsaOtRateComputation ?? "BASE_PLUS_AVG_HALF"} aria-label="FLSA overtime rate" style={{ width: 300, maxWidth: "100%" }}>
            <option value="BASE_PLUS_AVG_HALF">Base rate plus half the average rate</option>
            <option value="AVG_RATE">Average rate</option>
            <option value="BASE_RATE">Base rate</option>
          </Select>
        </Row>
        <Row label="Overtime counted">
          <span className="flex flex-wrap gap-5">
            {LEVELS.map((l) => (
              <Checkbox key={l.value} checked={levels.includes(l.value)} onChange={(v) => setLevels(toggle(levels, l.value, v))} label={l.label} />
            ))}
          </span>
          <input type="hidden" name="flsaOtLevelsJson" value={JSON.stringify(levels)} />
        </Row>
        <Row label="Counted as regular">
          <span className="flex flex-wrap gap-5">
            {LEVELS.map((l) => (
              <Checkbox key={l.value} checked={asRegular.includes(l.value)} onChange={(v) => setAsRegular(toggle(asRegular, l.value, v))} label={l.label} />
            ))}
          </span>
          <input type="hidden" name="flsaIncludeAsRegularJson" value={JSON.stringify(asRegular)} />
        </Row>
      </Section>
      <input type="hidden" name="flsaEnabled" value={on ? "true" : "false"} />
    </>
  );
}
