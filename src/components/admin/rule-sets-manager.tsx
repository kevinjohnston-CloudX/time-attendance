"use client";

import { Fragment, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createRuleSet, updateRuleSet, deleteRuleSet } from "@/actions/admin.actions";
import type { OtCycle, RuleSet } from "@prisma/client";

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

type RSFields = Omit<RuleSet, "id" | "tenantId" | "createdAt" | "updatedAt" | "employees" | "payPeriods" | "isActive" | "payPeriodAnchorDate" | "otCycleAnchorDate" | "otCycle"> & { isActive?: boolean; payPeriodAnchorDate?: string | null; otCycleAnchorDate?: string | null; otCycle?: OtCycle | null };
type OtPreset = Pick<RSFields, "dailyOtMinutes" | "dailyDtMinutes" | "dailyDtMaxMinutes" | "weeklyOtEnabled" | "weeklyOtMinutes" | "weeklyDtMinutes" | "weeklyDtMaxMinutes" | "consecutiveDayOtEnabled" | "consecutiveDayOtDay" | "consecutiveDayPayCycleOnly" | "consecutiveDayOtMaxMinutes" | "consecutiveDayDtMaxMinutes">;
type RSTab = "general" | "overtime" | "breaks";

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
    punchRoundingMinutes: Number(fd.get("punchRoundingMinutes")),
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

  const rsTabs: { id: RSTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "overtime", label: "Overtime" },
    { id: "breaks", label: "Breaks & Attendance" },
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
      </div>

      {/* Breaks & Attendance tab */}
      <div className={activeTab !== "breaks" ? "hidden" : "block"}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-zinc-500">Punch rounding</label>
            <select name="punchRoundingMinutes" defaultValue={rs?.punchRoundingMinutes ?? 0} className={inputCls}>
              <option value={0}>None (exact)</option>
              <option value={5}>5 min</option>
              <option value={6}>6 min</option>
              <option value={10}>10 min</option>
              <option value={15}>15 min (quarter-hour)</option>
              <option value={30}>30 min (half-hour)</option>
            </select>
          </div>
          <NumField name="mealBreakMinutes" label="Meal break duration" defaultValue={rs?.mealBreakMinutes ?? 30} unit="min" />
          <HoursField name="mealBreakAfterHours" label="Require meal after" defaultMinutes={rs?.mealBreakAfterMinutes ?? 300} />
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-zinc-500">Auto-deduct meal</label>
            <select name="autoDeductMeal" defaultValue={rs ? (rs.autoDeductMeal ? "true" : "false") : "false"} className={inputCls}>
              <option value="false">No — employee punches</option>
              <option value="true">Yes — deduct automatically</option>
            </select>
          </div>
          <NumField name="shortBreakMinutes" label="Short break duration" defaultValue={rs?.shortBreakMinutes ?? 15} unit="min" />
          <NumField name="shortBreaksPerDay" label="Short breaks per day" defaultValue={rs?.shortBreaksPerDay ?? 2} />
          <HoursField name="longShiftHours" label="Flag shift as long after" defaultMinutes={rs?.longShiftMinutes ?? 720} />
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

      <div className="flex flex-col gap-3">
        {ruleSets.map((rs) => (
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

      <button
        onClick={openCreate}
        className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
      >
        + Add Rule Set
      </button>

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
