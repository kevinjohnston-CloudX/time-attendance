"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, X } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { createShift, updateShift, deleteShift } from "@/actions/shift.actions";
import type { DayScheduleRow, MealConfig, BreakConfig, DifferentialConfig } from "@/actions/shift.actions";
import type { Shift } from "@prisma/client";
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
 * Shifts — the list on the design's list template, the editor in a dialog
 * behind it.
 *
 * <p>Times are shown as they are stored, on the 24-hour clock. The employee
 * list shows them the same way, and a night shift written "10:00 PM" on one
 * screen and "22:00" on the next is how the wrong one gets assigned.
 *
 * <p>The editor keeps its five tabs. Properties stays mounted when another tab
 * is showing — its inputs are uncontrolled, and unmounting the tab would throw
 * away everything typed into it. The other four tabs hold their state in this
 * component and reach the form as serialized JSON, so they can unmount safely.
 */

interface Props { shifts: Shift[] }

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function formatWorkDays(workDays: number[]): string {
  if (workDays.length === 0) return "No days";
  if (workDays.length === 7) return "Every day";
  const sorted = [...workDays].sort((a, b) => a - b);
  if (sorted.length === 5 && sorted[0] === 1 && sorted[4] === 5) return "Mon – Fri";
  if (sorted.length === 6 && sorted[0] === 1 && sorted[5] === 6) return "Mon – Sat";
  return sorted.map((d) => DAY_NAMES[d]).join(", ");
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function toDateInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

// ─── Shared form pieces ───────────────────────────────────────────────────────

/**
 * A control sized to sit inside a sentence or a grid cell.
 *
 * <p>The kit's Input is a 32px labelled field; the meal rules are sentences
 * with numbers in them and the schedule is a seven-row grid, and a full field
 * in either breaks the line it belongs to.
 */
function InlineInput({ width, ...rest }: InputHTMLAttributes<HTMLInputElement> & { width?: number | string }) {
  return (
    <input
      {...rest}
      className="ta-field rounded px-2 py-1 disabled:opacity-40"
      style={{
        width: width ?? 80,
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

/** A section inside the dialog, where a nested Card would be a panel on a panel. */
function FormSection({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="wms-overline">{label}</span>
      {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{hint}</span>}
      {children}
    </section>
  );
}

/**
 * One option of a set that is not a simple yes/no.
 *
 * <p>Radios rather than a segmented control wherever the options carry a line
 * of explanation: five segments of prose is a paragraph cut into buttons.
 */
function Radio({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  detail?: string;
}) {
  return (
    <label
      className="flex cursor-pointer items-start gap-2"
      style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
    >
      <input type="radio" checked={checked} onChange={onChange} className="mt-1 accent-[var(--fill-accent)]" />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {detail && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{detail}</span>}
      </span>
    </label>
  );
}

/** A rule written as a sentence with fields in it. */
function Sentence({ children }: { children: ReactNode }) {
  return (
    <p
      className="flex flex-wrap items-center gap-2"
      style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}
    >
      {children}
    </p>
  );
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
      {/* Quick-fill bar. Seven rows of the same two times is the common case,
          and typing them fourteen times is where a Wednesday ends up wrong. */}
      <div
        className="mb-3 flex flex-wrap items-center gap-2 rounded-md px-3 py-2"
        style={{ border: "1px solid var(--stroke-secondary)", background: "var(--surface-secondary)" }}
      >
        <span className="shrink-0 wms-label">Apply to workdays:</span>
        <InlineInput type="time" aria-label="Fill start time" value={fillStart} onChange={(e) => setFillStart(e.target.value)} width={120} />
        <span style={{ color: "var(--text-tertiary)" }}>–</span>
        <InlineInput type="time" aria-label="Fill end time" value={fillEnd} onChange={(e) => setFillEnd(e.target.value)} width={120} />
        <Button size="sm" onClick={applyFill}>Apply</Button>
      </div>

      <Table>
        <THead>
          <TR>
            <TH style={{ width: "10%" }}>Day</TH>
            <TH align="center" style={{ width: "10%" }}>Workday</TH>
            <TH align="center" style={{ width: "28%" }}>Day Window</TH>
            <TH align="center" style={{ width: "22%" }}>Start Time</TH>
            <TH align="center" style={{ width: "22%" }}>End Time</TH>
            <TH align="center" style={{ width: "8%" }}>Meal</TH>
          </TR>
        </THead>
        <TBody>
          {schedule.map((row) => (
            <TR key={row.day}>
              <TD
                style={{
                  fontWeight: "var(--weight-medium)",
                  color: row.isWorkday ? "var(--text-primary)" : "var(--text-tertiary)",
                }}
              >
                {DAY_NAMES[row.day]}
              </TD>

              <TD align="center">
                <span className="inline-flex">
                  <Checkbox
                    checked={row.isWorkday}
                    onChange={(checked) =>
                      update(row.day, {
                        isWorkday: checked,
                        startTime: checked ? (row.startTime ?? "08:00") : null,
                        endTime: checked ? (row.endTime ?? "17:00") : null,
                      })
                    }
                  />
                </span>
              </TD>

              <TD>
                <div className="flex items-center gap-1">
                  <InlineInput
                    type="time"
                    aria-label={`${DAY_NAMES[row.day]} window start`}
                    value={row.dayStart}
                    onChange={(e) => update(row.day, { dayStart: e.target.value })}
                    width="100%"
                  />
                  <span className="shrink-0" style={{ color: "var(--text-tertiary)" }}>–</span>
                  <InlineInput
                    type="time"
                    aria-label={`${DAY_NAMES[row.day]} window end`}
                    value={row.dayEnd}
                    onChange={(e) => update(row.day, { dayEnd: e.target.value })}
                    width="100%"
                  />
                </div>
              </TD>

              <TD>
                {row.isWorkday ? (
                  <InlineInput
                    type="time"
                    aria-label={`${DAY_NAMES[row.day]} start time`}
                    value={row.startTime ?? ""}
                    onChange={(e) => update(row.day, { startTime: e.target.value || null })}
                    width="100%"
                  />
                ) : (
                  <span style={{ color: "var(--text-disabled)" }}>—</span>
                )}
              </TD>

              <TD>
                {row.isWorkday ? (
                  <InlineInput
                    type="time"
                    aria-label={`${DAY_NAMES[row.day]} end time`}
                    value={row.endTime ?? ""}
                    onChange={(e) => update(row.day, { endTime: e.target.value || null })}
                    width="100%"
                  />
                ) : (
                  <span style={{ color: "var(--text-disabled)" }}>—</span>
                )}
              </TD>

              <TD>
                <InlineInput
                  type="number"
                  min={0}
                  max={480}
                  aria-label={`${DAY_NAMES[row.day]} meal minutes`}
                  value={row.mealMinutes}
                  onChange={(e) => update(row.day, { mealMinutes: parseInt(e.target.value, 10) || 0 })}
                  width="100%"
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <p className="mt-2" style={{ margin: 0, font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
        Day Window = punch eligibility window for that day (default 00:00 – 23:59). Meal = scheduled break in minutes.
      </p>
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

  return (
    <div className="flex flex-col gap-5">

      <FormSection label="Deduction Method">
        <div className="flex flex-col gap-1.5">
          {([
            ["HOURS_WORKED", "Hours Worked"],
            ["TIME_PERIOD", "Time Period"],
            ["SHIFT_PERIOD", "Shift Period"],
            ["ALLOWANCE_BY_HOURS", "Allowance by Hours"],
            ["ALLOWANCE_BY_TIME", "Allowance by Time"],
          ] as const).map(([val, label]) => (
            <Radio key={val} checked={cfg.deductionMethod === val} onChange={() => set("deductionMethod", val)} label={label} />
          ))}
        </div>
      </FormSection>

      <FormSection label="Rules">
        <Sentence>
          <span>Meal punch recognized when punch gap is between</span>
          <InlineInput
            type="number" min={1} max={60}
            aria-label="Minimum meal minutes"
            value={cfg.minMealMinutes}
            onChange={(e) => set("minMealMinutes", parseInt(e.target.value) || 15)}
          />
          <span>and</span>
          <InlineInput
            type="number" min={1} max={480}
            aria-label="Maximum meal minutes"
            value={cfg.maxMealMinutes}
            onChange={(e) => set("maxMealMinutes", parseInt(e.target.value) || 180)}
          />
          <span>minutes</span>
        </Sentence>

        <div className="flex flex-col gap-2.5">
          <div>
            <Checkbox
              checked={cfg.reimbursementEnabled}
              onChange={(v) => set("reimbursementEnabled", v)}
              label="Allow Pay Reimbursement"
            />
            {cfg.reimbursementEnabled && (
              <div className="ml-6 mt-2 flex flex-col gap-2">
                <Sentence>
                  <span>Up to</span>
                  <InlineInput
                    type="number" min={0}
                    aria-label="Reimbursement minutes"
                    value={cfg.reimbursementMinutes}
                    onChange={(e) => set("reimbursementMinutes", parseInt(e.target.value) || 0)}
                  />
                  <span>min · Daily limit</span>
                  <InlineInput
                    type="number" min={0}
                    aria-label="Daily reimbursement limit"
                    value={cfg.dailyReimbursementLimitMinutes}
                    onChange={(e) => set("dailyReimbursementLimitMinutes", parseInt(e.target.value) || 0)}
                  />
                  <span>min</span>
                </Sentence>
                <Checkbox
                  checked={cfg.doesNotAffectLongMealException}
                  onChange={(v) => set("doesNotAffectLongMealException", v)}
                  label="Does not affect long meal exception"
                />
              </div>
            )}
          </div>

          <Checkbox
            checked={cfg.autoDeduct}
            onChange={(v) => set("autoDeduct", v)}
            label="Automatically deduct the established minimum meal below"
          />

          <div>
            <Checkbox
              checked={cfg.noMealPunchBonusEnabled}
              onChange={(v) => set("noMealPunchBonusEnabled", v)}
              label="No Meal Punch Bonus"
            />
            {cfg.noMealPunchBonusEnabled && (
              <div className="ml-6 mt-2">
                <Sentence>
                  <InlineInput
                    type="number" min={0}
                    aria-label="Bonus minutes"
                    value={cfg.noMealPunchBonusMinutes}
                    onChange={(e) => set("noMealPunchBonusMinutes", parseInt(e.target.value) || 0)}
                  />
                  <span>minutes if employee works more than</span>
                  <InlineInput
                    type="number" min={0} step={0.5}
                    aria-label="Bonus work hours"
                    value={cfg.noMealPunchBonusWorkHours}
                    onChange={(e) => set("noMealPunchBonusWorkHours", parseFloat(e.target.value) || 0)}
                  />
                  <span>hours</span>
                </Sentence>
              </div>
            )}
          </div>

          <Checkbox
            checked={cfg.disableMinDeduction}
            onChange={(v) => set("disableMinDeduction", v)}
            label="Disable minimum deduction (use actual meal time)"
          />

          <Checkbox
            checked={cfg.useMealWindowForAutoDeduct}
            onChange={(v) => set("useMealWindowForAutoDeduct", v)}
            label="Use Meal Window for auto deduct"
          />

          <div>
            <Checkbox
              checked={cfg.createMealDeductionEnabled}
              onChange={(v) => set("createMealDeductionEnabled", v)}
              label="Create meal deduction"
            />
            {cfg.createMealDeductionEnabled && (
              <div className="ml-6 mt-2 flex flex-col gap-2">
                <Sentence>
                  <InlineInput
                    type="number" min={0} step={0.5}
                    aria-label="Hours after punching in"
                    value={cfg.createMealDeductionHours}
                    onChange={(e) => set("createMealDeductionHours", parseFloat(e.target.value) || 0)}
                  />
                  <span>hours after punching in</span>
                </Sentence>
                <Checkbox
                  checked={cfg.doNotSplitPunch}
                  onChange={(v) => set("doNotSplitPunch", v)}
                  label="Do not split punch"
                />
                <SegmentedControl
                  items={[
                    { value: "IN_OUT_PAIR", label: "In/Out Pair" },
                    { value: "WORKING_HOURS", label: "Working Hours" },
                  ]}
                  value={cfg.createMealBasis}
                  onChange={(v) => set("createMealBasis", v as MealConfig["createMealBasis"])}
                  size="sm"
                  ariaLabel="Create meal deduction basis"
                />
              </div>
            )}
          </div>

          <Checkbox
            checked={cfg.absoluteDeductionWindow}
            onChange={(v) => set("absoluteDeductionWindow", v)}
            label="Absolute deduction window"
          />

          <Checkbox
            checked={cfg.alwaysUseScheduledMeals}
            onChange={(v) => set("alwaysUseScheduledMeals", v)}
            label="Always use scheduled meals"
          />

          <div>
            <Checkbox
              checked={cfg.lateOutToMealEnabled}
              onChange={(v) => set("lateOutToMealEnabled", v)}
              label="Late Out to Meal"
            />
            {cfg.lateOutToMealEnabled && (
              <div className="ml-6 mt-2">
                <Sentence>
                  <span>After</span>
                  <InlineInput
                    type="number" min={0} step={0.5}
                    aria-label="Late out hours"
                    value={cfg.lateOutToMealHours}
                    onChange={(e) => set("lateOutToMealHours", parseFloat(e.target.value) || 0)}
                  />
                  <span>hours</span>
                </Sentence>
              </div>
            )}
          </div>

          <div>
            <Checkbox
              checked={cfg.sendWaivedToPayCode}
              onChange={(v) => set("sendWaivedToPayCode", v)}
              label="Send waived hours to pay code"
            />
            {cfg.sendWaivedToPayCode && (
              <div className="ml-6 mt-2">
                <InlineInput
                  type="text"
                  placeholder="Pay code ID"
                  aria-label="Waived pay code ID"
                  value={cfg.waivedPayCodeId}
                  onChange={(e) => set("waivedPayCodeId", e.target.value)}
                  width={160}
                />
              </div>
            )}
          </div>
        </div>
      </FormSection>

      <FormSection
        label="Meal Schedule"
        hint="Meal Before = meal window starts before scheduled end. Work At Least = minimum hours worked to trigger deduction."
      >
        <Table>
          <THead>
            <TR>
              <TH style={{ width: 80 }}>Meal</TH>
              <TH align="center" style={{ width: 144 }}>Meal Before (hrs)</TH>
              <TH align="center" style={{ width: 144 }}>Work At Least (hrs)</TH>
              <TH align="center" style={{ width: 112 }}>Deduct (min)</TH>
            </TR>
          </THead>
          <TBody>
            {MEAL_LABELS.map((label, i) => (
              <TR key={label}>
                <TD style={{ fontWeight: "var(--weight-medium)", color: "var(--text-secondary)" }}>{label}</TD>
                <TD>
                  <InlineInput
                    type="number" min={0} step={0.25}
                    aria-label={`${label} meal — meal before hours`}
                    value={cfg.meals[i].mealBeforeHours}
                    onChange={(e) => setMeal(i, { mealBeforeHours: parseFloat(e.target.value) || 0 })}
                    width="100%"
                  />
                </TD>
                <TD>
                  <InlineInput
                    type="number" min={0} step={0.25}
                    aria-label={`${label} meal — work at least hours`}
                    value={cfg.meals[i].workAtLeastHours}
                    onChange={(e) => setMeal(i, { workAtLeastHours: parseFloat(e.target.value) || 0 })}
                    width="100%"
                  />
                </TD>
                <TD>
                  <InlineInput
                    type="number" min={0}
                    aria-label={`${label} meal — deduct minutes`}
                    value={cfg.meals[i].deductMinutes}
                    onChange={(e) => setMeal(i, { deductMinutes: parseInt(e.target.value) || 0 })}
                    width="100%"
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </FormSection>

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

  return (
    <div className="flex flex-col gap-5">

      <FormSection label="Apply Paid Break?">
        <span className="self-start">
          <SegmentedControl
            items={YES_NO}
            value={cfg.applyPaidBreak ? "true" : "false"}
            onChange={(v) => set("applyPaidBreak", v === "true")}
            size="sm"
            ariaLabel="Apply paid break"
          />
        </span>
      </FormSection>

      {cfg.applyPaidBreak && (
        <>
          <FormSection label="Pay Method">
            <div className="flex flex-col gap-1.5">
              {([
                ["OFF_CLOCK_MINS", "Off-Clock Mins", "Pay based on how long the employee was actually punched out"],
                ["TIME_PERIOD", "Time Period", "Pay a fixed break duration regardless of actual punch gap"],
                ["WORK_HOURS", "Work Hours", "Allocate break pay based on total hours worked"],
              ] as const).map(([val, label, detail]) => (
                <Radio key={val} checked={cfg.payMethod === val} onChange={() => set("payMethod", val)} label={label} detail={detail} />
              ))}
            </div>
          </FormSection>

          <FormSection label="Break Recognition">
            <Sentence>
              <span>Considered a paid break when punch-out is within</span>
              <InlineInput
                type="number" min={0} max={480}
                aria-label="Punch-out within minutes"
                value={cfg.punchOutWithinMinutes}
                onChange={(e) => set("punchOutWithinMinutes", parseInt(e.target.value) || 0)}
              />
              <span>min</span>
            </Sentence>
            <Sentence>
              <span>Pay up to</span>
              <InlineInput
                type="number" min={0} max={480}
                aria-label="Pay up to minutes"
                value={cfg.payUpToMinutes}
                onChange={(e) => set("payUpToMinutes", parseInt(e.target.value) || 0)}
              />
              <span>min</span>
            </Sentence>
          </FormSection>
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

  return (
    <div className="flex flex-col gap-5">

      <FormSection label="Apply Pay Differential?">
        <span className="self-start">
          <SegmentedControl
            items={YES_NO}
            value={cfg.applyDifferential ? "true" : "false"}
            onChange={(v) => set("applyDifferential", v === "true")}
            size="sm"
            ariaLabel="Apply pay differential"
          />
        </span>
      </FormSection>

      {cfg.applyDifferential && (
        <FormSection
          label="Pay Method"
          hint="If no Global Template is found, the system will use the Time Segment settings."
        >
          <div className="flex flex-col gap-1.5">
            {([
              ["TIME_SEGMENT", "Time Segment", "Differential applied to each time segment worked (e.g. overnight hours)"],
              ["SHIFT_PERIOD", "Shift Period", "Differential applied to the entire shift period"],
              ["GLOBAL_DIFFERENTIAL", "Global Differential", "Uses a global differential template"],
            ] as const).map(([val, label, detail]) => (
              <Radio key={val} checked={cfg.payMethod === val} onChange={() => set("payMethod", val)} label={label} detail={detail} />
            ))}
          </div>
        </FormSection>
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

      {/* Properties tab — always mounted so defaultValue inputs survive tab switches */}
      <div className={tab !== "properties" ? "hidden" : "flex flex-col gap-4"}>

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,48%)),1fr))]">
          <Input label="Shift Name" name="name" required defaultValue={shift?.name ?? ""} placeholder="e.g. Morning Shift" />
          <Input label="Shift Number" name="number" type="number" min={1} defaultValue={shift?.number ?? ""} placeholder="e.g. 1" />
        </div>

        {isEdit && (
          <div className="w-44">
            <SelectField label="Status" name="isActive" defaultValue={shift?.isActive ? "true" : "false"}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </SelectField>
          </div>
        )}

        {/* The three choices below reach the action through hidden inputs
            rather than the segments themselves — a segmented control is a set
            of buttons, and buttons do not submit. */}
        <FormSection label="Employee Setup">
          <span className="self-start">
            <SegmentedControl
              items={[
                { value: "false", label: "Include" },
                { value: "true", label: "Exclude" },
              ]}
              value={excludeFromSetup ? "true" : "false"}
              onChange={(v) => setExcludeFromSetup(v === "true")}
              size="sm"
              ariaLabel="Employee setup visibility"
            />
          </span>
          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            {excludeFromSetup
              ? "Hidden from the employee assignment list."
              : "Visible in the employee assignment list."}
          </span>
          <input type="hidden" name="excludeFromSetup" value={excludeFromSetup ? "true" : "false"} />
        </FormSection>

        <FormSection label="Shift Cycle">
          <span className="self-start">
            <SegmentedControl
              items={[
                { value: "WEEKLY", label: "Weekly" },
                { value: "CUSTOM", label: "Custom" },
              ]}
              value={shiftCycle}
              onChange={(v) => setShiftCycle(v as "WEEKLY" | "CUSTOM")}
              size="sm"
              ariaLabel="Shift cycle"
            />
          </span>
          <input type="hidden" name="shiftCycle" value={shiftCycle} />
          {shiftCycle === "CUSTOM" && (
            <div className="grid gap-3 pl-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(180px,48%)),1fr))]">
              <Input label="Cycle Days" name="cycleDays" type="number" min={1} max={365} defaultValue={shift?.cycleDays ?? 7} />
              <Input label="Reference Date" name="cycleReferenceDate" type="date" defaultValue={toDateInputValue(shift?.cycleReferenceDate)} />
            </div>
          )}
        </FormSection>

        <FormSection label="Shift Type">
          <span className="self-start">
            <SegmentedControl
              items={(["FIXED", "FLEXIBLE", "DYNAMIC"] as const).map((t) => ({ value: t, label: titleCase(t) }))}
              value={shiftType}
              onChange={(v) => setShiftType(v as "FIXED" | "FLEXIBLE" | "DYNAMIC")}
              size="sm"
              ariaLabel="Shift type"
            />
          </span>
          <input type="hidden" name="shiftType" value={shiftType} />
          {shiftType === "DYNAMIC" && (
            <div className="pl-6">
              <Checkbox
                checked={useGroupQualifiers}
                onChange={setUseGroupQualifiers}
                label="Use Schedule Group Qualifiers"
              />
            </div>
          )}
          <input type="hidden" name="useScheduleGroupQualifiers" value={useGroupQualifiers ? "true" : "false"} />
        </FormSection>

        <div className="w-44">
          <Input
            label="Average Hours"
            name="averageHours"
            type="number" min={0} max={24} step={0.25}
            defaultValue={shift?.averageHours != null ? Number(shift.averageHours) : ""}
            placeholder="0.00"
          />
        </div>

      </div>

      {tab === "definition" && (
        <DefinitionTable schedule={schedule} onChange={setSchedule} />
      )}

      {tab === "meal" && (
        <MealTab cfg={mealConfig} onChange={setMealConfig} />
      )}

      {tab === "break" && (
        <BreakTab cfg={breakConfig} onChange={setBreakConfig} />
      )}

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
  const [view, setView] = useState<View>("active");
  const [search, setSearch] = useState("");

  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }
  const searchLower = search.trim().toLowerCase();
  const visible = shifts
    .filter((s) => (view === "all" ? true : view === "active" ? s.isActive : !s.isActive))
    .filter((s) => !searchLower || s.name.toLowerCase().includes(searchLower));

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
    <div className="mt-4 flex flex-col gap-2.5">
      {error && !editingShift && !showCreate && <Banner tone="error" body={error} />}

      <Toolbar count={visible.length} countLabel="shift">
        <SegmentedControl
          items={VIEWS}
          value={view}
          onChange={(v) => setView(v as View)}
          size="sm"
          ariaLabel="Which shifts to show"
        />
        <SearchInput value={search} onValueChange={setSearch} placeholder="Search shifts…" width={220} />
        <Button onClick={openCreate}>New Shift</Button>
      </Toolbar>

      <Card padding={0}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="h-8 w-8" />}
            title={searchLower ? `No shifts match “${search}”` : view === "active" ? "No active shifts" : "No shifts"}
            body="A shift is the pattern an employee is scheduled against — the days, the hours and the meal rules."
            action={
              searchLower
                ? <Button size="sm" hierarchy="secondary" onClick={() => setSearch("")}>Clear search</Button>
                : <Button size="sm" onClick={openCreate}>New Shift</Button>
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH numeric style={{ width: 56 }}>#</TH>
                  <TH>Shift</TH>
                  <TH align="center">Start</TH>
                  <TH align="center">End</TH>
                  <TH>Days</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((shift) => {
                  const sched = shift.daySchedule as DayScheduleRow[] | null;
                  const workDays = sched ? sched.filter((r) => r.isWorkday).map((r) => r.day) : shift.workDays;
                  // The per-day schedule is the truth once a shift has one; the
                  // top-level startTime/endTime are the legacy pair kept for
                  // shifts nobody has opened since the day grid arrived.
                  const firstWork = sched?.find((r) => r.isWorkday && r.startTime && r.endTime);
                  const start = firstWork?.startTime ?? shift.startTime;
                  const end = firstWork?.endTime ?? shift.endTime;
                  return (
                    <TR key={shift.id} onClick={() => openEdit(shift)}>
                      <TD numeric style={{ color: "var(--text-secondary)" }}>
                        {shift.number ?? <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                      </TD>
                      <TD style={{ fontWeight: "var(--weight-medium)" }}>{shift.name}</TD>
                      <TD align="center" className="tabular" style={{ color: "var(--text-secondary)" }}>{start}</TD>
                      <TD align="center" className="tabular" style={{ color: "var(--text-secondary)" }}>{end}</TD>
                      <TD style={{ color: "var(--text-secondary)" }}>{formatWorkDays(workDays)}</TD>
                      <TD style={{ color: "var(--text-secondary)" }}>{titleCase(shift.shiftType)}</TD>
                      <TD>
                        {shift.isActive ? (
                          <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                        ) : (
                          // statusTone would answer "warning"; a retired shift
                          // is not something to go and fix.
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
              total={shifts.length}
              label={shifts.length === 1 ? "shift" : "shifts"}
            />
          </>
        )}
      </Card>

      {showCreate && (
        <Modal title="New Shift" onClose={closeCreate}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={handleCreate}>
            <ShiftFields />
            <div className="mt-5 flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
              <Button type="submit" disabled={isPending}>{isPending ? "Creating…" : "Create"}</Button>
              <Button type="button" hierarchy="secondary" onClick={closeCreate}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {editingShift && (
        <Modal title={`Edit: ${editingShift.name}`} onClose={closeModal}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={(e) => handleUpdate(editingShift, e)}>
            <ShiftFields shift={editingShift} isEdit />
            <div
              className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-4"
              style={{ borderTop: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex gap-2">
                <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save changes"}</Button>
                <Button type="button" hierarchy="secondary" onClick={closeModal}>Cancel</Button>
              </div>
              {confirmDeleteId === editingShift.id ? (
                <div className="flex items-center gap-2">
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Are you sure?</span>
                  <Button type="button" tone="error" size="sm" onClick={() => handleDelete(editingShift.id)} disabled={isPending}>
                    {isPending ? "Deleting…" : "Yes, delete"}
                  </Button>
                  <Button type="button" hierarchy="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button type="button" hierarchy="link" tone="error" size="sm" onClick={() => setConfirmDeleteId(editingShift.id)}>
                  Delete shift
                </Button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
