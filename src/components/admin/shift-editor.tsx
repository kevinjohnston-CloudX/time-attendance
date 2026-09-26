"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import type { Shift } from "@prisma/client";
import { createShift, updateShift, deleteShift } from "@/actions/shift.actions";
import type { BreakConfig, DayScheduleRow, DifferentialConfig, MealConfig } from "@/actions/shift.actions";
import { Banner, Button, Checkbox, Input, Select } from "@/components/ui";
import { DeleteSection, EditorPage, Num, Row, Section, Tick, jumpToSection, words, type EditorGroup } from "./setup/editor-page";
import { ChoiceField, ClockInput, DeleteAction, StatusBadge, StatusField, clock12, saveError } from "./setup/setup-ui";

/**
 * A shift, edited on a page of its own: the week it is scheduled for, how
 * meals are recognised and deducted, and the break and differential rules.
 *
 * <p>Times are typed and shown on a 12 hour clock and stored as "HH:mm". The
 * old editor showed them as stored, on the 24 hour clock.
 *
 * <p>Only part of a shift reaches pay or attendance today: the week schedule
 * (days, times, day windows and meal minutes), fixed or flexible, the weekly
 * cycle, the meal punch range, automatic deduction and the first meal. The
 * rest is saved but read by nothing, and says so.
 *
 * <p>The separate scheduled meal start and end, which the leave calculation
 * reads, have no field here. The old editor sent them empty on every save,
 * wiping them; they now go back exactly as they were.
 */

export type ShiftRow = Shift & { _count?: { employees: number; scheduleDays: number } };
type PayCodeOption = { id: string; code: number; label: string; isActive?: boolean };

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const caption = { font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" } as const;

export function defaultDaySchedule(shift?: Shift | null): DayScheduleRow[] {
  const existing = shift?.daySchedule as DayScheduleRow[] | null | undefined;
  if (existing && Array.isArray(existing) && existing.length === 7) return existing;
  // Built from the older workDays and start and end pair.
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

function defaultMealConfig(shift?: Shift | null): MealConfig {
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

function defaultBreakConfig(shift?: Shift | null): BreakConfig {
  const existing = shift?.breakConfig as BreakConfig | null | undefined;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) return existing;
  return { applyPaidBreak: false, payMethod: "OFF_CLOCK_MINS", punchOutWithinMinutes: 0, payUpToMinutes: 0 };
}

function defaultDifferentialConfig(shift?: Shift | null): DifferentialConfig {
  const existing = shift?.differentialConfig as DifferentialConfig | null | undefined;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) return existing;
  return { applyDifferential: false, payMethod: "TIME_SEGMENT" };
}

function parseShiftForm(fd: FormData) {
  const numberRaw = parseInt(fd.get("number") as string, 10);
  const avgRaw = parseFloat(fd.get("averageHours") as string);
  const cycleDaysRaw = parseInt(fd.get("cycleDays") as string, 10);
  const shiftCycle = (fd.get("shiftCycle") as string) || "WEEKLY";
  const json = <T,>(name: string): T | undefined => {
    try {
      return JSON.parse(fd.get(name) as string) as T;
    } catch {
      return undefined;
    }
  };
  return {
    name: ((fd.get("name") as string) ?? "").trim(),
    number: isNaN(numberRaw) || numberRaw < 1 ? null : numberRaw,
    workDays: [] as number[], // derived from daySchedule in the action
    mealBreakStart: (fd.get("mealBreakStart") as string) || "",
    mealBreakEnd: (fd.get("mealBreakEnd") as string) || "",
    excludeFromSetup: fd.get("excludeFromSetup") === "true",
    shiftCycle: shiftCycle as "WEEKLY" | "CUSTOM",
    cycleDays: isNaN(cycleDaysRaw) || cycleDaysRaw < 1 ? 7 : cycleDaysRaw,
    cycleReferenceDate: shiftCycle === "CUSTOM" ? ((fd.get("cycleReferenceDate") as string) || null) : null,
    shiftType: ((fd.get("shiftType") as string) || "FIXED") as "FIXED" | "FLEXIBLE" | "DYNAMIC",
    useScheduleGroupQualifiers: fd.get("useScheduleGroupQualifiers") === "true",
    averageHours: isNaN(avgRaw) ? null : avgRaw,
    daySchedule: json<DayScheduleRow[]>("dayScheduleJson"),
    mealConfig: json<MealConfig>("mealConfigJson"),
    breakConfig: json<BreakConfig>("breakConfigJson"),
    differentialConfig: json<DifferentialConfig>("differentialConfigJson"),
  };
}

const toMinutes = (t: string | null) => {
  const m = /^(\d{2}):(\d{2})$/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/* ── The editor ───────────────────────────────────────────────────────── */

export function ShiftEditor({ shift, payCodes }: { shift: ShiftRow | null; payCodes: PayCodeOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const people = shift?._count?.employees ?? 0;
  const days = shift?._count?.scheduleDays ?? 0;

  // A shift saved before these settings existed has none of its own. Its
  // blanks are only filled in once somebody changes that part: filling the
  // meal settings, say, would stop very short and very long punch gaps
  // counting as meals, which changes pay.
  const [touched, setTouched] = useState({ week: false, meal: false, brk: false, diff: false });
  const [schedule, setScheduleRaw] = useState<DayScheduleRow[]>(() => defaultDaySchedule(shift));
  const [meal, setMealRaw] = useState<MealConfig>(() => defaultMealConfig(shift));
  const [brk, setBrkRaw] = useState<BreakConfig>(() => defaultBreakConfig(shift));
  const [diff, setDiffRaw] = useState<DifferentialConfig>(() => defaultDifferentialConfig(shift));
  const setSchedule = (v: DayScheduleRow[]) => (setScheduleRaw(v), setTouched((t) => ({ ...t, week: true })));
  const setMeal = (v: MealConfig) => (setMealRaw(v), setTouched((t) => ({ ...t, meal: true })));
  const setBrk = (v: BreakConfig) => (setBrkRaw(v), setTouched((t) => ({ ...t, brk: true })));
  const setDiff = (v: DifferentialConfig) => (setDiffRaw(v), setTouched((t) => ({ ...t, diff: true })));
  /** Sent only for a new shift, one that already has it, or once changed. */
  const send = (stored: unknown, changed: boolean, value: unknown) => (!shift || stored != null || changed ? JSON.stringify(value) : "");
  const noMealSettings = !!shift && shift.mealConfig == null && !touched.meal;
  const [shiftType, setShiftType] = useState<string>(shift?.shiftType ?? "FIXED");
  const [cycle, setCycle] = useState<string>(shift?.shiftCycle ?? "WEEKLY");
  const [qualifiers, setQualifiers] = useState(shift?.useScheduleGroupQualifiers ?? false);

  const setM = <K extends keyof MealConfig>(k: K, v: MealConfig[K]) => setMeal({ ...meal, [k]: v });
  const setMealRow = (i: number, patch: Partial<MealConfig["meals"][number]>) =>
    setMeal({ ...meal, meals: (meal.meals ?? []).map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const firstMeal = meal.meals?.[0] ?? { mealBeforeHours: 0, workAtLeastHours: 0, deductMinutes: 0 };
  const workdays = schedule.filter((d) => d.isWorkday).length;

  const groups: EditorGroup[] = [
    {
      title: "Basics",
      areas: [
        { id: "general", label: "General" },
        { id: "cycle", label: "Cycle", count: cycle === "WEEKLY" ? "Weekly" : "Custom" },
      ],
    },
    { title: "Schedule", areas: [{ id: "week", label: "Week schedule", count: `${workdays} ${workdays === 1 ? "day" : "days"}` }] },
    {
      title: "Meals",
      areas: [
        { id: "meals", label: "Meal punches", count: meal.autoDeduct ? "Auto" : undefined },
        { id: "meal-other", label: "Other meal rules" },
      ],
    },
    {
      title: "Pay",
      areas: [
        { id: "breaks", label: "Paid breaks", count: brk.applyPaidBreak ? "On" : "Off" },
        { id: "differential", label: "Differential", count: diff.applyDifferential ? "On" : "Off" },
      ],
    },
  ];
  if (shift) groups.push({ title: "Other", areas: [{ id: "delete", label: "Delete shift" }] });

  function onSubmit(form: HTMLFormElement) {
    const fields = parseShiftForm(new FormData(form));
    if (!fields.name) {
      jumpToSection("general");
      return setError("Give the shift a name.");
    }
    const missing = schedule.find((d) => d.isWorkday && (!d.startTime || !d.endTime));
    if (missing) {
      jumpToSection("week");
      return setError(`${DAY_NAMES[missing.day]} is a workday with no start or end time.`);
    }
    setError(null);
    startTransition(async () => {
      if (!shift) {
        const result = await createShift(fields);
        if (!result.success) return setError(saveError(result.error));
        setSavedCount((n) => n + 1);
        router.replace(`/admin/rules-setup/shifts/${result.data.id}`);
        return;
      }
      const result = await updateShift({ shiftId: shift.id, isActive: new FormData(form).get("isActive") === "true", ...fields });
      if (!result.success) return setError(saveError(result.error));
      setSavedCount((n) => n + 1);
      router.refresh();
    });
  }

  function remove() {
    if (!shift) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteShift({ shiftId: shift.id });
      if (!result.success) return setError(saveError(result.error));
      setSavedCount((n) => n + 1);
      router.push("/admin/rules-setup?tab=shifts");
    });
  }

  return (
    <EditorPage
      noun="shift"
      title={shift ? shift.name : "New shift"}
      subtitle={
        shift ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {shift.number != null && <span className="tabular">No. {shift.number}</span>}
            {shift.number != null && <span aria-hidden="true">·</span>}
            <span>
              {people.toLocaleString()} {people === 1 ? "employee" : "employees"}
            </span>
            <StatusBadge active={shift.isActive} />
          </span>
        ) : (
          "The days and hours a group of employees is scheduled for"
        )
      }
      back={{ href: "/admin/rules-setup?tab=shifts", label: "Shifts" }}
      groups={groups}
      isNew={!shift}
      submitLabel={shift ? "Save changes" : "Add shift"}
      pending={isPending}
      error={error}
      savedCount={savedCount}
      onSubmit={onSubmit}
    >
      {/* Read by the leave calculation, with no field of their own here. */}
      <input type="hidden" name="mealBreakStart" value={shift?.mealBreakStart ?? ""} />
      <input type="hidden" name="mealBreakEnd" value={shift?.mealBreakEnd ?? ""} />
      <input type="hidden" name="dayScheduleJson" value={send(shift?.daySchedule, touched.week, schedule)} />
      <input type="hidden" name="mealConfigJson" value={send(shift?.mealConfig, touched.meal, meal)} />
      <input type="hidden" name="breakConfigJson" value={send(shift?.breakConfig, touched.brk, brk)} />
      <input type="hidden" name="differentialConfigJson" value={send(shift?.differentialConfig, touched.diff, diff)} />

      {/* ── General ── */}
      <Section id="general" title="General" hint="What the shift is called and how its hours are set.">
        <Row label="Name">
          <span className="w-full max-w-[420px]">
            <Input name="name" required defaultValue={shift?.name ?? ""} placeholder="Morning shift" aria-label="Name" />
          </span>
        </Row>
        <Row label="Shift number" hint="Optional. Sorts the list and shows beside the name.">
          <Num name="number" min={1} step={1} defaultValue={shift?.number ?? ""} placeholder="1" aria-label="Shift number" />
        </Row>
        {shift && (
          <Row label="Status" hint="An inactive shift stays on the employees who have it.">
            <StatusField defaultActive={shift.isActive} bare />
          </Row>
        )}
        <Row
          label="Type"
          hint="Fixed shifts on a weekly cycle are the ones Live Attendance works out expected hours for."
        >
          <ChoiceField
            label=""
            name="shiftType"
            defaultValue={shiftType}
            onChange={setShiftType}
            options={[
              { value: "FIXED", label: "Fixed" },
              { value: "FLEXIBLE", label: "Flexible" },
              { value: "DYNAMIC", label: "Dynamic" },
            ]}
          />
        </Row>
        {shiftType === "DYNAMIC" && (
          <Row label="Schedule groups" unused>
            <Tick checked={qualifiers} onChange={setQualifiers} label="Use schedule group qualifiers" />
          </Row>
        )}
        <input type="hidden" name="useScheduleGroupQualifiers" value={qualifiers ? "true" : "false"} />
        <Row label="Average hours a day" unused>
          <Num
            name="averageHours"
            min={0}
            max={24}
            step={0.25}
            defaultValue={shift?.averageHours != null ? Number(shift.averageHours) : ""}
            placeholder="8"
            unit="hours"
            aria-label="Average hours a day"
          />
        </Row>
        <Row label="When setting up an employee" unused hint="Meant to hide this shift from the list when an employee is set up.">
          <ChoiceField
            label=""
            name="excludeFromSetup"
            defaultValue={shift?.excludeFromSetup ? "true" : "false"}
            options={[
              { value: "false", label: "Listed" },
              { value: "true", label: "Hidden" },
            ]}
          />
        </Row>
      </Section>

      {/* ── Cycle ── */}
      <Section id="cycle" title="Cycle" hint="Whether the shift repeats every week or over a cycle of its own.">
        <Row label="Repeats">
          <ChoiceField
            label=""
            name="shiftCycle"
            defaultValue={cycle}
            onChange={setCycle}
            options={[
              { value: "WEEKLY", label: "Every week" },
              { value: "CUSTOM", label: "A custom cycle" },
            ]}
          />
        </Row>
        {cycle === "CUSTOM" && (
          <>
            <Row label="Days in the cycle" unused>
              <Num name="cycleDays" min={1} max={365} defaultValue={shift?.cycleDays ?? 7} unit="days" aria-label="Days in the cycle" />
            </Row>
            <Row label="A day the cycle starts on" unused>
              <span style={{ width: 180 }}>
                <Input
                  name="cycleReferenceDate"
                  type="date"
                  aria-label="A day the cycle starts on"
                  defaultValue={shift?.cycleReferenceDate ? new Date(shift.cycleReferenceDate).toISOString().slice(0, 10) : ""}
                />
              </span>
            </Row>
          </>
        )}
      </Section>

      <WeekSchedule schedule={schedule} onChange={setSchedule} />

      {/* ── Meal punches ── */}
      <Section
        id="meals"
        title="Meal punches"
        hint="How a meal is recognised from punches, and whether one is taken off automatically. For people on this shift, this replaces the rule set's meal setting."
      >
        {noMealSettings && (
          <div className="px-5 pb-3.5">
            <Banner
              tone="info"
              title="No meal settings of its own yet"
              body="Today any punch gap on this shift counts as a meal, and none is taken off automatically. The values below are the usual starting point, and only apply once you change one of them and save."
            />
          </div>
        )}
        <Row label="A meal is a punch gap of" hint="A shorter or longer gap is counted as worked time.">
          <Num value={meal.minMealMinutes ?? 0} onChange={(e) => setM("minMealMinutes", parseInt(e.target.value) || 0)} min={0} max={480} width={80} aria-label="Shortest meal gap" />
          <span style={words}>to</span>
          <Num value={meal.maxMealMinutes ?? 0} onChange={(e) => setM("maxMealMinutes", parseInt(e.target.value) || 0)} min={0} max={480} width={80} unit="min" aria-label="Longest meal gap" />
        </Row>
        <Row label="Short meals" hint="Otherwise a meal shorter than the rule set's meal length is deducted as the full length.">
          <Tick
            checked={!!meal.disableMinDeduction}
            onChange={(v) => setM("disableMinDeduction", v)}
            label="Deduct only the time actually taken"
          />
        </Row>
        <Row label="Automatic meal">
          <span className="flex flex-col gap-2.5">
            <Tick checked={!!meal.autoDeduct} onChange={(v) => setM("autoDeduct", v)} label="Take a meal off automatically" />
            {meal.autoDeduct && (
              <span className="flex flex-wrap items-center gap-2" style={words}>
                <span>Take off</span>
                <Num value={firstMeal.deductMinutes} onChange={(e) => setMealRow(0, { deductMinutes: parseInt(e.target.value) || 0 })} min={0} width={80} aria-label="Minutes taken off" />
                <span>min once someone has worked</span>
                <Num value={firstMeal.workAtLeastHours} onChange={(e) => setMealRow(0, { workAtLeastHours: parseFloat(e.target.value) || 0 })} min={0} step={0.25} width={80} unit="hours" aria-label="Hours worked first" />
              </span>
            )}
          </span>
        </Row>
      </Section>

      <OtherMealRules meal={meal} set={setM} setRow={setMealRow} payCodes={payCodes} />

      {/* ── Paid breaks ── */}
      <Section
        id="breaks"
        title="Paid breaks"
        hint="Short breaks that are paid even though the employee punched out."
        on={brk.applyPaidBreak}
        onToggle={(v) => setBrk({ ...brk, applyPaidBreak: v })}
        offText="Off. Time punched out is not paid."
        unused
      >
        <Row label="Paid by" hint={PAY_METHOD_HINT[brk.payMethod] ?? undefined}>
          <Select value={brk.payMethod} onChange={(e) => setBrk({ ...brk, payMethod: e.target.value as BreakConfig["payMethod"] })} aria-label="Paid by" style={{ width: 280 }}>
            <option value="OFF_CLOCK_MINS">Time punched out</option>
            <option value="TIME_PERIOD">A set break length</option>
            <option value="WORK_HOURS">Hours worked</option>
          </Select>
        </Row>
        <Row label="Counts as a break when out for">
          <Num value={brk.punchOutWithinMinutes} onChange={(e) => setBrk({ ...brk, punchOutWithinMinutes: parseInt(e.target.value) || 0 })} min={0} max={480} unit="min or less" aria-label="Counts as a break when out for" />
        </Row>
        <Row label="Pay up to">
          <Num value={brk.payUpToMinutes} onChange={(e) => setBrk({ ...brk, payUpToMinutes: parseInt(e.target.value) || 0 })} min={0} max={480} unit="min" aria-label="Pay up to" />
        </Row>
      </Section>

      {/* ── Differential ── */}
      <Section
        id="differential"
        title="Differential"
        hint="Extra pay for working this shift, such as nights."
        on={diff.applyDifferential}
        onToggle={(v) => setDiff({ ...diff, applyDifferential: v })}
        offText="Off. No differential."
        unused
      >
        <Row label="Applied to" hint="Without a company template, the time worked setting is used.">
          <Select value={diff.payMethod} onChange={(e) => setDiff({ ...diff, payMethod: e.target.value as DifferentialConfig["payMethod"] })} aria-label="Applied to" style={{ width: 320 }}>
            <option value="TIME_SEGMENT">Each stretch of time worked, such as overnight hours</option>
            <option value="SHIFT_PERIOD">The whole shift</option>
            <option value="GLOBAL_DIFFERENTIAL">The company differential template</option>
          </Select>
        </Row>
      </Section>

      {shift && (
        <DeleteSection
          title="Delete shift"
          reason={
            people > 0
              ? `${people.toLocaleString()} ${people === 1 ? "employee is" : "employees are"} on it, so it cannot be deleted. Set it to inactive instead.`
              : days > 0
                ? `It is on ${days.toLocaleString()} scheduled ${days === 1 ? "day" : "days"}, so it cannot be deleted. Set it to inactive instead.`
                : "Nobody is on this shift. Deleting it cannot be undone."
          }
        >
          {people === 0 && days === 0 && (
            <DeleteAction label="Delete shift" question="Delete this shift for good?" pending={isPending} onDelete={remove} />
          )}
        </DeleteSection>
      )}
    </EditorPage>
  );
}

const PAY_METHOD_HINT: Record<string, string> = {
  OFF_CLOCK_MINS: "Pays however long the employee was punched out.",
  TIME_PERIOD: "Pays a set length, whatever the punches say.",
  WORK_HOURS: "Pays according to the hours worked.",
};

/* ── Week schedule ────────────────────────────────────────────────────── */

function WeekSchedule({ schedule, onChange }: { schedule: DayScheduleRow[]; onChange: (s: DayScheduleRow[]) => void }) {
  const [fillStart, setFillStart] = useState<string | null>("08:00");
  const [fillEnd, setFillEnd] = useState<string | null>("16:30");
  const defaultWindow = (d: DayScheduleRow) => d.dayStart === "00:00" && d.dayEnd === "23:59";
  const [windows, setWindows] = useState(() => schedule.some((d) => !defaultWindow(d)));
  const update = (day: number, patch: Partial<DayScheduleRow>) => onChange(schedule.map((r) => (r.day === day ? { ...r, ...patch } : r)));

  return (
    <Section id="week" title="Week schedule" hint="The days worked and the scheduled start and end of each.">
      <Row label="Set every workday to" hint="Fills in the start and end of each ticked day below.">
        <ClockInput value={fillStart} onChange={setFillStart} label="Start for every workday" />
        <span style={words}>to</span>
        <ClockInput value={fillEnd} onChange={setFillEnd} label="End for every workday" />
        <Button
          size="sm"
          hierarchy="secondary"
          disabled={!fillStart || !fillEnd}
          onClick={() => onChange(schedule.map((r) => (r.isWorkday ? { ...r, startTime: fillStart, endTime: fillEnd } : r)))}
        >
          Apply to workdays
        </Button>
      </Row>
      {schedule.map((d) => {
        const start = toMinutes(d.startTime);
        const end = toMinutes(d.endTime);
        const overnight = start != null && end != null && end <= start;
        return (
          <div
            key={d.day}
            className="flex flex-col gap-2 px-5 py-3"
            style={{ borderTop: "1px solid var(--stroke-divider)" }}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-[150px] flex-none">
                <Checkbox
                  checked={d.isWorkday}
                  onChange={(on) =>
                    update(d.day, {
                      isWorkday: on,
                      startTime: on ? (d.startTime ?? fillStart ?? "08:00") : null,
                      endTime: on ? (d.endTime ?? fillEnd ?? "17:00") : null,
                    })
                  }
                  label={DAY_NAMES[d.day]}
                />
              </span>
              {d.isWorkday ? (
                <>
                  <ClockInput value={d.startTime} onChange={(v) => update(d.day, { startTime: v })} label={`${DAY_NAMES[d.day]} start`} required />
                  <span style={words}>to</span>
                  <ClockInput value={d.endTime} onChange={(v) => update(d.day, { endTime: v })} label={`${DAY_NAMES[d.day]} end`} required />
                  {overnight && <span style={caption}>next day</span>}
                  <span className="ml-auto inline-flex items-center gap-2">
                    <Num
                      value={d.mealMinutes}
                      onChange={(e) => update(d.day, { mealMinutes: parseInt(e.target.value, 10) || 0 })}
                      min={0}
                      max={480}
                      width={72}
                      unit="min meal"
                      aria-label={`${DAY_NAMES[d.day]} meal minutes`}
                    />
                  </span>
                </>
              ) : (
                <span style={caption}>Day off</span>
              )}
            </div>
            {windows && (
              <div className="flex flex-wrap items-center gap-2 pl-[162px]" style={words}>
                <span>Punches count toward this day from</span>
                <ClockInput value={d.dayStart} onChange={(v) => v && update(d.day, { dayStart: v })} label={`${DAY_NAMES[d.day]} window start`} required />
                <span>to</span>
                <ClockInput value={d.dayEnd} onChange={(v) => v && update(d.day, { dayEnd: v })} label={`${DAY_NAMES[d.day]} window end`} required />
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
        <Tick checked={windows} onChange={setWindows} label="Show the day windows" />
        <span style={caption}>
          {schedule.every(defaultWindow)
            ? `Every day runs from ${clock12("00:00")} to ${clock12("23:59")}.`
            : "Some days have a window of their own."}
        </span>
      </div>
    </Section>
  );
}

/* ── Meal rules nothing reads yet ─────────────────────────────────────── */

const MEALS = ["First", "Second", "Third", "Fourth"] as const;

function OtherMealRules({
  meal,
  set,
  setRow,
  payCodes,
}: {
  meal: MealConfig;
  set: <K extends keyof MealConfig>(k: K, v: MealConfig[K]) => void;
  setRow: (i: number, patch: Partial<MealConfig["meals"][number]>) => void;
  payCodes: PayCodeOption[];
}) {
  const waivedKnown = !meal.waivedPayCodeId || payCodes.some((p) => p.id === meal.waivedPayCodeId);
  return (
    <Section id="meal-other" title="Other meal rules" hint="More ways a meal can be recognised, credited or deducted." unused>
      <Row label="Deducted by">
        <Select value={meal.deductionMethod ?? "HOURS_WORKED"} onChange={(e) => set("deductionMethod", e.target.value as MealConfig["deductionMethod"])} aria-label="Deducted by" style={{ width: 240 }}>
          <option value="HOURS_WORKED">Hours worked</option>
          <option value="TIME_PERIOD">Time of day</option>
          <option value="SHIFT_PERIOD">Shift period</option>
          <option value="ALLOWANCE_BY_HOURS">Allowance by hours</option>
          <option value="ALLOWANCE_BY_TIME">Allowance by time of day</option>
        </Select>
      </Row>
      <Row label="Paying back meal time">
        <span className="flex flex-col gap-2.5">
          <Tick checked={!!meal.reimbursementEnabled} onChange={(v) => set("reimbursementEnabled", v)} label="Pay back some of the meal" />
          {meal.reimbursementEnabled && (
            <>
              <span className="flex flex-wrap items-center gap-2" style={words}>
                <span>Up to</span>
                <Num value={meal.reimbursementMinutes ?? 0} onChange={(e) => set("reimbursementMinutes", parseInt(e.target.value) || 0)} min={0} width={72} unit="min, and no more than" aria-label="Minutes paid back" />
                <Num value={meal.dailyReimbursementLimitMinutes ?? 0} onChange={(e) => set("dailyReimbursementLimitMinutes", parseInt(e.target.value) || 0)} min={0} width={72} unit="min a day" aria-label="Most paid back a day" />
              </span>
              <Tick checked={!!meal.doesNotAffectLongMealException} onChange={(v) => set("doesNotAffectLongMealException", v)} label="Does not affect the long meal exception" />
            </>
          )}
        </span>
      </Row>
      <Row label="No meal punched">
        <span className="flex flex-col gap-2.5">
          <Tick checked={!!meal.noMealPunchBonusEnabled} onChange={(v) => set("noMealPunchBonusEnabled", v)} label="Pay a bonus when no meal is punched" />
          {meal.noMealPunchBonusEnabled && (
            <span className="flex flex-wrap items-center gap-2" style={words}>
              <Num value={meal.noMealPunchBonusMinutes ?? 0} onChange={(e) => set("noMealPunchBonusMinutes", parseInt(e.target.value) || 0)} min={0} width={72} unit="min when someone works more than" aria-label="Bonus minutes" />
              <Num value={meal.noMealPunchBonusWorkHours ?? 0} onChange={(e) => set("noMealPunchBonusWorkHours", parseFloat(e.target.value) || 0)} min={0} step={0.5} width={72} unit="hours" aria-label="Bonus after hours worked" />
            </span>
          )}
        </span>
      </Row>
      <Row label="Making a meal">
        <span className="flex flex-col gap-2.5">
          <Tick checked={!!meal.createMealDeductionEnabled} onChange={(v) => set("createMealDeductionEnabled", v)} label="Add a meal deduction" />
          {meal.createMealDeductionEnabled && (
            <>
              <span className="flex flex-wrap items-center gap-2" style={words}>
                <Num value={meal.createMealDeductionHours ?? 0} onChange={(e) => set("createMealDeductionHours", parseFloat(e.target.value) || 0)} min={0} step={0.5} width={72} unit="hours after clocking in" aria-label="Hours after clocking in" />
              </span>
              <Tick checked={!!meal.doNotSplitPunch} onChange={(v) => set("doNotSplitPunch", v)} label="Do not split the punch" />
              <ChoiceField
                label=""
                name="_createMealBasis"
                defaultValue={meal.createMealBasis ?? "IN_OUT_PAIR"}
                onChange={(v) => set("createMealBasis", v as MealConfig["createMealBasis"])}
                options={[
                  { value: "IN_OUT_PAIR", label: "Each clock in and out" },
                  { value: "WORKING_HOURS", label: "Hours worked" },
                ]}
              />
            </>
          )}
        </span>
      </Row>
      <Row label="Also">
        <span className="flex flex-col gap-2.5">
          <Tick checked={!!meal.useMealWindowForAutoDeduct} onChange={(v) => set("useMealWindowForAutoDeduct", v)} label="Use the meal window for automatic deduction" />
          <Tick checked={!!meal.absoluteDeductionWindow} onChange={(v) => set("absoluteDeductionWindow", v)} label="Fixed deduction window" />
          <Tick checked={!!meal.alwaysUseScheduledMeals} onChange={(v) => set("alwaysUseScheduledMeals", v)} label="Always use the scheduled meals" />
          <span className="flex flex-wrap items-center gap-2" style={words}>
            <Tick checked={!!meal.lateOutToMealEnabled} onChange={(v) => set("lateOutToMealEnabled", v)} label="Late out to meal after" />
            <Num value={meal.lateOutToMealHours ?? 0} onChange={(e) => set("lateOutToMealHours", parseFloat(e.target.value) || 0)} min={0} step={0.5} width={72} unit="hours" aria-label="Late out to meal after hours" />
          </span>
        </span>
      </Row>
      <Row label="Waived meal hours">
        <span className="flex flex-wrap items-center gap-2">
          <Tick checked={!!meal.sendWaivedToPayCode} onChange={(v) => set("sendWaivedToPayCode", v)} label="Post them to" />
          <Select
            value={meal.waivedPayCodeId ?? ""}
            onChange={(e) => set("waivedPayCodeId", e.target.value)}
            aria-label="Pay code for waived meal hours"
            style={{ width: 240 }}
          >
            <option value="">No pay code</option>
            {!waivedKnown && <option value={meal.waivedPayCodeId}>A pay code that no longer exists</option>}
            {payCodes
              .filter((p) => p.isActive !== false || p.id === meal.waivedPayCodeId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} {p.label}
                </option>
              ))}
          </Select>
        </span>
      </Row>
      <Row label="Meals in a day" hint="Only the first meal's minutes and hours are used, and only when a meal is taken off automatically.">
        <span className="flex w-full flex-col gap-2">
          {MEALS.map((label, i) => {
            const m = meal.meals?.[i] ?? { mealBeforeHours: 0, workAtLeastHours: 0, deductMinutes: 0 };
            return (
              <span key={label} className="flex flex-wrap items-center gap-2" style={words}>
                <span className="w-[64px]" style={{ fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
                  {label}
                </span>
                <Num value={m.deductMinutes} onChange={(e) => setRow(i, { deductMinutes: parseInt(e.target.value) || 0 })} min={0} width={72} unit="min after" aria-label={`${label} meal, minutes`} />
                <Num value={m.workAtLeastHours} onChange={(e) => setRow(i, { workAtLeastHours: parseFloat(e.target.value) || 0 })} min={0} step={0.25} width={72} unit="hours worked, window" aria-label={`${label} meal, hours worked`} />
                <Num value={m.mealBeforeHours} onChange={(e) => setRow(i, { mealBeforeHours: parseFloat(e.target.value) || 0 })} min={0} step={0.25} width={72} unit="hours before the end" aria-label={`${label} meal, window before the end`} />
              </span>
            );
          })}
        </span>
      </Row>
    </Section>
  );
}
