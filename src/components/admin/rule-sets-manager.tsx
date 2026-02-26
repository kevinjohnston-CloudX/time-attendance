"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRuleSet, updateRuleSet } from "@/actions/admin.actions";
import type { RuleSet } from "@prisma/client";

interface Props { ruleSets: RuleSet[] }

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const smInputCls = "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const sectionHdrCls = "col-span-full mb-0.5 border-b border-zinc-200 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-700";

type RSFields = Omit<RuleSet, "id" | "createdAt" | "updatedAt" | "employees">;
type OtPreset = Pick<RSFields, "dailyOtMinutes" | "dailyDtMinutes" | "weeklyOtMinutes" | "consecutiveDayOtDay">;

// ─── State OT Presets ─────────────────────────────────────────────────────────

const FEDERAL: OtPreset = { dailyOtMinutes: 1440, dailyDtMinutes: 1440, weeklyOtMinutes: 2400, consecutiveDayOtDay: 7 };

interface StateEntry { label: string; abbr: string; preset: OtPreset; rule: string }

const SPECIAL_STATES: StateEntry[] = [
  { label: "California", abbr: "CA", preset: { dailyOtMinutes: 480, dailyDtMinutes: 720, weeklyOtMinutes: 2400, consecutiveDayOtDay: 7 }, rule: "OT after 8h/day · DT after 12h/day · Weekly OT after 40h" },
  { label: "Alaska", abbr: "AK", preset: { dailyOtMinutes: 480, dailyDtMinutes: 1440, weeklyOtMinutes: 2400, consecutiveDayOtDay: 7 }, rule: "OT after 8h/day or 40h/week" },
  { label: "Nevada", abbr: "NV", preset: { dailyOtMinutes: 480, dailyDtMinutes: 1440, weeklyOtMinutes: 2400, consecutiveDayOtDay: 7 }, rule: "OT after 8h/day (qualifying employees) or 40h/week" },
  { label: "Colorado", abbr: "CO", preset: { dailyOtMinutes: 720, dailyDtMinutes: 1440, weeklyOtMinutes: 2400, consecutiveDayOtDay: 7 }, rule: "OT after 12h/day or 40h/week" },
  { label: "Puerto Rico", abbr: "PR", preset: { dailyOtMinutes: 480, dailyDtMinutes: 1440, weeklyOtMinutes: 2400, consecutiveDayOtDay: 7 }, rule: "OT after 8h/day or 40h/week" },
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMins(mins: number): string {
  if (mins >= 1440) return "disabled";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function parseForm(fd: FormData): RSFields {
  return {
    name: fd.get("name") as string,
    // dailyOtMinutes / dailyDtMinutes come from hidden inputs (set by ThresholdField)
    dailyOtMinutes: Number(fd.get("dailyOtMinutes")),
    dailyDtMinutes: Number(fd.get("dailyDtMinutes")),
    // hour-based fields are multiplied back to minutes
    weeklyOtMinutes: Number(fd.get("weeklyOtHours")) * 60,
    consecutiveDayOtDay: Number(fd.get("consecutiveDayOtDay")),
    punchRoundingMinutes: Number(fd.get("punchRoundingMinutes")),
    mealBreakMinutes: Number(fd.get("mealBreakMinutes")),
    mealBreakAfterMinutes: Number(fd.get("mealBreakAfterHours")) * 60,
    autoDeductMeal: fd.get("autoDeductMeal") === "true",
    shortBreakMinutes: Number(fd.get("shortBreakMinutes")),
    shortBreaksPerDay: Number(fd.get("shortBreaksPerDay")),
    longShiftMinutes: Number(fd.get("longShiftHours")) * 60,
    isDefault: fd.get("isDefault") === "true",
  };
}

// ─── Field components ─────────────────────────────────────────────────────────

/**
 * Toggle + hours input for a daily OT/DT threshold.
 * Writes the final value (in minutes, or 1440 when disabled) to a hidden input.
 */
function ThresholdField({ name, label, defaultMinutes }: { name: string; label: string; defaultMinutes: number }) {
  const off = defaultMinutes >= 1440;
  const [enabled, setEnabled] = useState(!off);
  const [hrs, setHrs] = useState(off ? 8 : Math.round(defaultMinutes / 60));

  return (
    <div>
      <span className="mb-1.5 block text-xs text-zinc-500">{label}</span>
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded"
          />
          Enable
        </label>
        {enabled ? (
          <>
            <span className="text-xs text-zinc-400">after</span>
            <input
              type="number"
              value={hrs}
              onChange={(e) => setHrs(Number(e.target.value))}
              min={1}
              max={23}
              className={`w-16 ${smInputCls}`}
            />
            <span className="text-xs text-zinc-400">h</span>
          </>
        ) : (
          <span className="text-xs text-zinc-400">Disabled</span>
        )}
      </div>
      <input type="hidden" name={name} value={enabled ? hrs * 60 : 1440} />
    </div>
  );
}

/** Number input stored as hours (displayed), converted to minutes in parseForm. */
function HoursField({ name, label, defaultMinutes, min = 1 }: { name: string; label: string; defaultMinutes: number; min?: number }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-zinc-500">{label}</label>
      <div className="flex items-center gap-2">
        <input
          name={name}
          type="number"
          min={min}
          defaultValue={Math.round(defaultMinutes / 60)}
          className={`w-20 ${smInputCls}`}
        />
        <span className="text-xs text-zinc-400">h</span>
      </div>
    </div>
  );
}

/** Plain number input (value already in the right unit). */
function NumField({ name, label, defaultValue, unit, min = 0 }: { name: string; label: string; defaultValue: number; unit?: string; min?: number }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-zinc-500">{label}</label>
      <div className="flex items-center gap-2">
        <input
          name={name}
          type="number"
          min={min}
          defaultValue={defaultValue}
          className={`w-20 ${smInputCls}`}
        />
        {unit && <span className="text-xs text-zinc-400">{unit}</span>}
      </div>
    </div>
  );
}

// ─── State preset picker ──────────────────────────────────────────────────────

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
        State OT Preset{" "}
        <span className="font-normal text-zinc-400">(optional — pre-fills OT fields)</span>
      </label>
      <select value={value} onChange={handleChange} className={inputCls}>
        <option value="">— Choose a state —</option>
        <optgroup label="States with Daily OT Rules">
          {SPECIAL_STATES.map((s) => (
            <option key={s.abbr} value={s.abbr}>{s.label} ({s.abbr})</option>
          ))}
        </optgroup>
        <optgroup label="Federal FLSA — 40h/week OT only">
          {FEDERAL_STATES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </optgroup>
      </select>
      {hint && <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

// ─── Rule set form fields ─────────────────────────────────────────────────────

function RuleSetFields({ rs }: { rs?: RuleSet }) {
  const [otKey, setOtKey] = useState(0);
  const [otDefaults, setOtDefaults] = useState<OtPreset>({
    dailyOtMinutes: rs?.dailyOtMinutes ?? FEDERAL.dailyOtMinutes,
    dailyDtMinutes: rs?.dailyDtMinutes ?? FEDERAL.dailyDtMinutes,
    weeklyOtMinutes: rs?.weeklyOtMinutes ?? FEDERAL.weeklyOtMinutes,
    consecutiveDayOtDay: rs?.consecutiveDayOtDay ?? FEDERAL.consecutiveDayOtDay,
  });

  function applyPreset(preset: OtPreset) {
    setOtDefaults(preset);
    setOtKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      <StatePresetPicker onChange={applyPreset} />

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">

        {/* Name */}
        <div className="col-span-full">
          <label className="mb-1 block text-xs text-zinc-500">Rule Set Name</label>
          <input name="name" defaultValue={rs?.name} required placeholder="e.g. California Hourly" className={inputCls} />
        </div>

        {/* ── Overtime Rules ── */}
        <p className={sectionHdrCls}>Overtime Rules</p>

        {/* Keyed fragment — remounts when a state preset is applied */}
        <Fragment key={otKey}>
          <ThresholdField name="dailyOtMinutes" label="Daily OT threshold" defaultMinutes={otDefaults.dailyOtMinutes} />
          <ThresholdField name="dailyDtMinutes" label="Daily DT threshold" defaultMinutes={otDefaults.dailyDtMinutes} />
          <HoursField name="weeklyOtHours" label="Weekly OT threshold" defaultMinutes={otDefaults.weeklyOtMinutes} />
          <NumField name="consecutiveDayOtDay" label="OT on consecutive day #" defaultValue={otDefaults.consecutiveDayOtDay} min={1} />
        </Fragment>

        {/* ── Breaks & Attendance ── */}
        <p className={sectionHdrCls}>Breaks & Attendance</p>

        <div>
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

        <div>
          <label className="mb-1 block text-xs text-zinc-500">Auto-deduct meal</label>
          <select name="autoDeductMeal" defaultValue={rs ? (rs.autoDeductMeal ? "true" : "false") : "false"} className={inputCls}>
            <option value="false">No — employee punches</option>
            <option value="true">Yes — deduct automatically</option>
          </select>
        </div>

        <NumField name="shortBreakMinutes" label="Short break duration" defaultValue={rs?.shortBreakMinutes ?? 15} unit="min" />
        <NumField name="shortBreaksPerDay" label="Short breaks per day" defaultValue={rs?.shortBreaksPerDay ?? 2} />
        <HoursField name="longShiftHours" label="Flag shift as long after" defaultMinutes={rs?.longShiftMinutes ?? 720} />

        {/* ── Settings ── */}
        <p className={sectionHdrCls}>Settings</p>

        <div className="col-span-2">
          <label className="mb-1 block text-xs text-zinc-500">Default rule set</label>
          <select name="isDefault" defaultValue={rs ? (rs.isDefault ? "true" : "false") : "false"} className={inputCls}>
            <option value="false">No</option>
            <option value="true">Yes — assign to new employees by default</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ─── Main manager ─────────────────────────────────────────────────────────────

export function RuleSetsManager({ ruleSets }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createRuleSet(parseForm(new FormData(e.currentTarget)));
      if (!result.success) { setError(result.error); return; }
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleUpdate(ruleSetId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateRuleSet({ ruleSetId, ...parseForm(new FormData(e.currentTarget)) });
      if (!result.success) { setError(result.error); return; }
      setEditingId(null);
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
        {ruleSets.map((rs) =>
          editingId === rs.id ? (
            <form
              key={rs.id}
              onSubmit={(e) => handleUpdate(rs.id, e)}
              className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800/40 dark:bg-blue-900/10"
            >
              <RuleSetFields rs={rs} />
              <div className="mt-4 flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save"}</button>
                <button type="button" onClick={() => setEditingId(null)} className={cancelBtnCls}>Cancel</button>
              </div>
            </form>
          ) : (
            <div key={rs.id} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-zinc-900 dark:text-white">{rs.name}</span>
                  {rs.isDefault && (
                    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      Default
                    </span>
                  )}
                </div>
                <button onClick={() => setEditingId(rs.id)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                  Edit
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                Daily OT: {fmtMins(rs.dailyOtMinutes)} · Daily DT: {fmtMins(rs.dailyDtMinutes)} ·
                Weekly OT: {fmtMins(rs.weeklyOtMinutes)} · Consec day: day {rs.consecutiveDayOtDay}
              </p>
            </div>
          )
        )}
      </div>

      {showCreate ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="mb-4 text-sm font-semibold text-zinc-900 dark:text-white">New Rule Set</p>
          <RuleSetFields />
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
            <button type="button" onClick={() => setShowCreate(false)} className={cancelBtnCls}>Cancel</button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
        >
          + Add Rule Set
        </button>
      )}
    </div>
  );
}
