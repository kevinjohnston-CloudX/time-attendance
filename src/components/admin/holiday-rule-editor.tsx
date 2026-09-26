"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Plus, X } from "lucide-react";
import { useRouter } from "@/components/layout/navigation-progress";
import type { HolidayRule } from "@prisma/client";
import { createHolidayRule, updateHolidayRule, deleteHolidayRule } from "@/actions/holiday-rule.actions";
import { Button, Checkbox, Input, Select } from "@/components/ui";
import { DeleteSection, EditorPage, Num, Row, Section, Tick, jumpToSection, words, type EditorGroup } from "./setup/editor-page";
import { ChoiceField, DeleteAction, StatusBadge, StatusField, saveError } from "./setup/setup-ui";

/**
 * A holiday rule, edited on a page of its own: how much a holiday pays, who
 * qualifies, what they must work around it, and the overrides and proration
 * that adjust it.
 *
 * <p>Nearly all of it is read by the pay calculation. The old window
 * disabled the number boxes of any option switched off, and a disabled box
 * is not sent, so saving put those numbers back to their defaults: a tenure
 * requirement switched off lost its days, proration switched off lost its
 * look back. Every value is now sent as it stands, switched on or not.
 *
 * <p>Pay bucket, working premium and counting toward overtime are read by
 * the calculation but have had no control since before this page; they go
 * back exactly as stored.
 */

export type HolidayRuleRow = HolidayRule & {
  assignedHolidays?: { holiday: { id: string; name: string; date: string | Date } }[];
  _count?: { employees: number };
};
type PayCodeOption = { id: string; code: number | string; label: string; isActive?: boolean };
type OverrideRow = { date: string; hours: string; payCodeId: string };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const caption = { font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" } as const;
/** Stored minutes as hours, to 2 places: saving gives back the same minute. */
const hrs = (mins: number | null | undefined, fallback: number) => (mins == null ? fallback : Math.round((mins / 60) * 100) / 100);
const num = (v: unknown, fallback: number) => (v == null || v === "" ? fallback : Number(v));

function buildPayload(fd: FormData) {
  const n = (k: string, d: number) => {
    const v = fd.get(k);
    return v == null || v === "" ? d : Number(v);
  };
  const b = (k: string) => fd.get(k) === "true";
  const numStr = fd.get("number") as string;
  return {
    number: numStr ? Number(numStr) : null,
    name: ((fd.get("name") as string) ?? "").trim(),
    creditMethod: fd.get("creditMethod") as string,
    creditHours: n("creditHours", 8),
    maxCreditHours: n("maxCreditHours", 0),
    payBucket: fd.get("payBucket") as string,
    payCodeId: (fd.get("payCodeId") as string) || null,
    workingPremium: n("workingPremium", 1),
    includeOnProbation: b("includeOnProbation"),
    tenureRequiredEnabled: b("tenureRequiredEnabled"),
    tenureRequiredDays: n("tenureRequiredDays", 90),
    tenureRequiredBasis: (fd.get("tenureRequiredBasis") as string) || "HIRE_DATE",
    tenureRequiredUnit: (fd.get("tenureRequiredUnit") as string) || "DAYS",
    dailyWeeklyAveragingOnly: b("dailyWeeklyAveragingOnly"),
    requireDayBefore: b("requireDayBefore"),
    requireDayAfter: b("requireDayAfter"),
    requireDayBeforeOrAfter: b("requireDayBeforeOrAfter"),
    minPeriodHours: n("minPeriodHours", 0),
    requireDaysWorkedEnabled: b("requireDaysWorkedEnabled"),
    requireDaysWorkedCount: n("requireDaysWorkedCount", 0),
    requireDaysWorkedPeriod: n("requireDaysWorkedPeriod", 0),
    requireDaysWorkedPeriodUnit: (fd.get("requireDaysWorkedPeriodUnit") as string) || "DAY",
    requireDaysWorkedMinDailyHours: n("requireDaysWorkedMinDailyHours", 0),
    requireScheduledHoursPct: b("requireScheduledHoursPct"),
    requireScheduledHoursPctValue: n("requireScheduledHoursPctValue", 50),
    mustNotWorkOnHoliday: b("mustNotWorkOnHoliday"),
    useDynamicSchedules: b("useDynamicSchedules"),
    excludedWeekDays: (fd.get("excludedWeekDays") as string) || "",
    bypassAfterEligibility: b("bypassAfterEligibility"),
    payNonWorkingHolidayOnly: b("payNonWorkingHolidayOnly"),
    postWorkingHoursToAccrual: b("postWorkingHoursToAccrual"),
    postWorkingHoursMax: n("postWorkingHoursMax", 0),
    postWorkingHoursExcessEnabled: b("postWorkingHoursExcessEnabled"),
    postWorkingHoursExcessMin: n("postWorkingHoursExcessMin", 0),
    accrualCode: ((fd.get("accrualCode") as string) ?? "").trim() || null,
    includeNonCalcAttendance: b("includeNonCalcAttendance"),
    countTowardOt: fd.get("countTowardOt") as string,
    prorateEnabled: b("prorateEnabled"),
    prorateLookbackDays: n("prorateLookbackDays", 28),
    prorateIncludeCurrentWeek: fd.get("prorateIncludeCurrentWeek") !== "false",
    prorateUseCustomRange: b("prorateUseCustomRange"),
    prorateAppliedRule: (fd.get("prorateAppliedRule") as string) || "AVERAGE_DAILY",
    prorateThresholdHours: n("prorateThresholdHours", 0),
    prorateMultiplier: n("prorateMultiplier", 0),
    prorateAverageDailyMaxHours: n("prorateAverageDailyMaxHours", 8),
    prorateExcludeOt: b("prorateExcludeOt"),
    birthdayIsHoliday: b("birthdayIsHoliday"),
    holidayOverridesEnabled: b("holidayOverridesEnabled"),
    holidayOverrides: (() => {
      try {
        return JSON.parse((fd.get("holidayOverrides") as string) || "null");
      } catch {
        return null;
      }
    })(),
  };
}

function PayCodeSelect({
  name,
  value,
  defaultValue,
  onChange,
  payCodes,
  ariaLabel,
  width = 260,
}: {
  name?: string;
  value?: string;
  defaultValue?: string | null;
  onChange?: (v: string) => void;
  payCodes: PayCodeOption[];
  ariaLabel: string;
  width?: number;
}) {
  const current = value ?? defaultValue ?? "";
  const list = payCodes.filter((p) => p.isActive !== false || p.id === current);
  const props = value !== undefined ? { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange?.(e.target.value) } : { defaultValue: defaultValue ?? "" };
  return (
    <Select name={name} aria-label={ariaLabel} style={{ width, maxWidth: "100%" }} {...props}>
      <option value="">No pay code</option>
      {current && !list.some((p) => p.id === current) && <option value={current}>A pay code that no longer exists</option>}
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.code} {p.label}
          {p.isActive === false ? " (inactive)" : ""}
        </option>
      ))}
    </Select>
  );
}

export function HolidayRuleEditor({ rule, payCodes }: { rule: HolidayRuleRow | null; payCodes: PayCodeOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const people = rule?._count?.employees ?? 0;
  const holidays = rule?.assignedHolidays ?? [];

  const [creditMethod, setCreditMethod] = useState<string>(rule?.creditMethod ?? "FIXED_HOURS");
  const [probation, setProbation] = useState(rule?.includeOnProbation ?? false);
  const [tenure, setTenure] = useState(rule?.tenureRequiredEnabled ?? false);
  const [avgOnly, setAvgOnly] = useState(rule?.dailyWeeklyAveragingOnly ?? false);
  const [dayBefore, setDayBefore] = useState(rule?.requireDayBefore ?? false);
  const [dayAfter, setDayAfter] = useState(rule?.requireDayAfter ?? false);
  const [beforeOrAfter, setBeforeOrAfter] = useState(rule?.requireDayBeforeOrAfter ?? false);
  const [daysWorked, setDaysWorked] = useState(rule?.requireDaysWorkedEnabled ?? false);
  const [pct, setPct] = useState(rule?.requireScheduledHoursPct ?? false);
  const [notOnHoliday, setNotOnHoliday] = useState(rule?.mustNotWorkOnHoliday ?? false);
  const [dynamic, setDynamic] = useState(rule?.useDynamicSchedules ?? false);
  const [bypass, setBypass] = useState(rule?.bypassAfterEligibility ?? false);
  const [excluded, setExcluded] = useState<number[]>(rule?.excludedWeekDays ?? []);
  const [nonWorkingOnly, setNonWorkingOnly] = useState(rule?.payNonWorkingHolidayOnly ?? false);
  const [toAccrual, setToAccrual] = useState(rule?.postWorkingHoursToAccrual ?? false);
  const [excessOn, setExcessOn] = useState(rule?.postWorkingHoursExcessEnabled ?? false);
  const [nonCalc, setNonCalc] = useState(rule?.includeNonCalcAttendance ?? true);
  const [birthday, setBirthday] = useState(rule?.birthdayIsHoliday ?? false);
  const [overridesOn, setOverridesOn] = useState(rule?.holidayOverridesEnabled ?? false);
  const [overrides, setOverrides] = useState<OverrideRow[] | null>(() =>
    Array.isArray(rule?.holidayOverrides) ? (rule.holidayOverrides as unknown as OverrideRow[]) : rule ? (rule.holidayOverrides as null) : [],
  );
  const [prorate, setProrate] = useState(rule?.prorateEnabled ?? false);
  const [customRange, setCustomRange] = useState(rule?.prorateUseCustomRange ?? false);
  const [applied, setApplied] = useState<string>(rule?.prorateAppliedRule ?? "AVERAGE_DAILY");
  const [excludeOt, setExcludeOt] = useState(rule?.prorateExcludeOt ?? false);

  const rows = overrides ?? [];
  const setRow = (i: number, patch: Partial<OverrideRow>) => setOverrides(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const eligibilityOn = [dayBefore, dayAfter, beforeOrAfter, daysWorked, pct, notOnHoliday].filter(Boolean).length;

  const groups: EditorGroup[] = [
    { title: "Basics", areas: [{ id: "general", label: "General" }] },
    {
      title: "Pay",
      areas: [
        { id: "pay", label: "Holiday pay" },
        { id: "who", label: "Who qualifies" },
        { id: "work", label: "Work around it", count: eligibilityOn ? `${eligibilityOn} on` : "None" },
        { id: "other", label: "Other rules" },
      ],
    },
    {
      title: "Holidays",
      areas: [
        { id: "holidays", label: "Holidays it pays", count: String(holidays.length) },
        { id: "overrides", label: "Overrides", count: overridesOn ? "On" : "Off" },
        { id: "prorate", label: "Proration", count: prorate ? "On" : "Off" },
      ],
    },
  ];
  if (rule) groups.push({ title: "Other", areas: [{ id: "delete", label: "Delete rule" }] });

  function onSubmit(form: HTMLFormElement) {
    const fd = new FormData(form);
    const payload = buildPayload(fd);
    if (!payload.name) {
      jumpToSection("general");
      return setError("Give the holiday rule a name.");
    }
    setError(null);
    startTransition(async () => {
      if (!rule) {
        const result = await createHolidayRule(payload);
        if (!result.success) return setError(saveError(result.error));
        setSavedCount((c) => c + 1);
        router.replace(`/admin/rules-setup/holiday-rules/${result.data.id}`);
        return;
      }
      const result = await updateHolidayRule({ ruleId: rule.id, isActive: fd.get("isActive") as string, ...payload });
      if (!result.success) return setError(saveError(result.error));
      setSavedCount((c) => c + 1);
      router.refresh();
    });
  }

  function remove() {
    if (!rule) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteHolidayRule({ ruleId: rule.id });
      if (!result.success) return setError(saveError(result.error));
      setSavedCount((c) => c + 1);
      router.push("/admin/rules-setup?tab=holiday-rules");
    });
  }

  return (
    <EditorPage
      noun="holiday rule"
      title={rule ? rule.name : "New holiday rule"}
      subtitle={
        rule ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {rule.number != null && <span className="tabular">Rule {rule.number}</span>}
            {rule.number != null && <span aria-hidden="true">·</span>}
            <span>
              {people.toLocaleString()} {people === 1 ? "employee" : "employees"}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {holidays.length} {holidays.length === 1 ? "holiday" : "holidays"}
            </span>
            <StatusBadge active={rule.isActive} />
          </span>
        ) : (
          "Who is paid for a holiday, and how much"
        )
      }
      back={{ href: "/admin/rules-setup?tab=holiday-rules", label: "Holiday rules" }}
      groups={groups}
      isNew={!rule}
      submitLabel={rule ? "Save changes" : "Add holiday rule"}
      pending={isPending}
      error={error}
      savedCount={savedCount}
      onSubmit={onSubmit}
    >
      {/* Read by the calculation, with no control here: back as stored. */}
      <input type="hidden" name="payBucket" value={rule?.payBucket ?? "HOLIDAY"} />
      <input type="hidden" name="workingPremium" value={rule ? String(rule.workingPremium / 100) : "1"} />
      <input type="hidden" name="countTowardOt" value={rule?.countTowardOt !== false ? "true" : "false"} />

      {/* ── General ── */}
      <Section id="general" title="General" hint="What the rule is called.">
        <Row label="Name">
          <span className="w-full max-w-[420px]">
            <Input name="name" required defaultValue={rule?.name ?? ""} placeholder="Standard holiday" aria-label="Name" />
          </span>
        </Row>
        <Row label="Rule number" hint="Optional. Shows beside the name wherever the rule is picked.">
          <Num name="number" min={1} max={99999} step={1} defaultValue={rule?.number ?? ""} placeholder="10" aria-label="Rule number" />
        </Row>
        {rule && (
          <Row label="Status" hint="An inactive rule stays on the employees who have it.">
            <StatusField defaultActive={rule.isActive} bare />
          </Row>
        )}
      </Section>

      {/* ── Holiday pay ── */}
      <Section id="pay" title="Holiday pay" hint="How many hours a holiday pays, and the pay code they are posted to.">
        <Row label="Hours paid">
          <ChoiceField
            label=""
            name="creditMethod"
            defaultValue={creditMethod}
            onChange={setCreditMethod}
            options={[
              { value: "FIXED_HOURS", label: "A set number" },
              { value: "SCHEDULED_HOURS", label: "The scheduled hours" },
              { value: "ACTUAL_WORKED", label: "The hours worked" },
            ]}
          />
        </Row>
        <div hidden={creditMethod !== "FIXED_HOURS"}>
          <Row label="Set number of hours">
            <Num name="creditHours" min={0} max={24} step={0.25} defaultValue={hrs(rule?.creditMinutes, 8)} unit="hours" aria-label="Set number of hours" />
          </Row>
        </div>
        <Row label="Most hours paid" hint="0 means no limit.">
          <Num name="maxCreditHours" min={0} max={24} step={0.25} defaultValue={hrs(rule?.maxCreditMinutes, 0)} unit="hours" aria-label="Most hours paid" />
        </Row>
        <Row label="Pay code">
          <PayCodeSelect name="payCodeId" defaultValue={rule?.payCodeId} payCodes={payCodes} ariaLabel="Holiday pay code" />
        </Row>
      </Section>

      {/* ── Who qualifies ── */}
      <Section id="who" title="Who qualifies" hint="Which employees on this rule are paid for a holiday at all.">
        <Row label="Probation">
          <Tick name="includeOnProbation" checked={probation} onChange={setProbation} label="Employees on probation qualify" />
        </Row>
        <Row label="Time with the company">
          <span className="flex flex-col gap-2.5">
            <Tick name="tenureRequiredEnabled" checked={tenure} onChange={setTenure} label="Only after a length of time with the company" />
            <span hidden={!tenure} className="flex flex-wrap items-center gap-2" style={words}>
              <span>At least</span>
              <Num name="tenureRequiredDays" min={0} width={80} defaultValue={rule?.tenureRequiredDays ?? 90} aria-label="How long" />
              <Select name="tenureRequiredUnit" defaultValue={rule?.tenureRequiredUnit ?? "DAYS"} aria-label="Days or months" style={{ width: 110 }}>
                <option value="DAYS">days</option>
                <option value="MONTHS">months</option>
              </Select>
              <span>from the</span>
              <Select name="tenureRequiredBasis" defaultValue={rule?.tenureRequiredBasis ?? "HIRE_DATE"} aria-label="Counted from" style={{ width: 190 }}>
                <option value="HIRE_DATE">hire date</option>
                <option value="ADJUSTED_HIRE_DATE">adjusted hire date</option>
              </Select>
              <span>before the holiday</span>
            </span>
          </span>
        </Row>
        <Row label="Averaging" unused>
          <Tick
            name="dailyWeeklyAveragingOnly"
            checked={avgOnly}
            onChange={setAvgOnly}
            label="Only employees on daily or weekly averaging"
          />
        </Row>
      </Section>

      {/* ── Work around the holiday ── */}
      <Section
        id="work"
        title="Work around it"
        hint="What someone must work around the holiday to be paid for it. Any pay code that counts as attendance counts as a day worked."
      >
        <Row label="The days either side">
          <span className="flex flex-col gap-2.5">
            <Tick name="requireDayBefore" checked={dayBefore} onChange={setDayBefore} label="Must work the scheduled day before" />
            <Tick name="requireDayAfter" checked={dayAfter} onChange={setDayAfter} label="Must work the scheduled day after" />
            <Tick
              name="requireDayBeforeOrAfter"
              checked={beforeOrAfter}
              onChange={setBeforeOrAfter}
              label="Must work the scheduled day before or the scheduled day after"
            />
          </span>
        </Row>
        <Row label="The holiday itself">
          <Tick name="mustNotWorkOnHoliday" checked={notOnHoliday} onChange={setNotOnHoliday} label="Must not work on the holiday" />
        </Row>
        <Row label="Days worked before it">
          <span className="flex flex-col gap-2.5">
            <Tick name="requireDaysWorkedEnabled" checked={daysWorked} onChange={setDaysWorked} label="Must have worked a number of days before it" />
            <span hidden={!daysWorked} className="flex flex-col gap-2.5">
              <span className="flex flex-wrap items-center gap-2" style={words}>
                <span>At least</span>
                <Num name="requireDaysWorkedCount" min={0} max={365} width={72} defaultValue={rule?.requireDaysWorkedCount ?? 0} aria-label="Days worked" />
                <span>days in the last</span>
                <Num name="requireDaysWorkedPeriod" min={0} max={365} width={72} defaultValue={rule?.requireDaysWorkedPeriod ?? 0} aria-label="Period length" />
                <Select name="requireDaysWorkedPeriodUnit" defaultValue={rule?.requireDaysWorkedPeriodUnit ?? "DAY"} aria-label="Days or weeks" style={{ width: 110 }}>
                  <option value="DAY">days</option>
                  <option value="WEEK">weeks</option>
                </Select>
              </span>
              <span className="flex flex-wrap items-center gap-2" style={words}>
                <span>A day counts once someone works</span>
                <Num
                  name="requireDaysWorkedMinDailyHours"
                  min={0}
                  step={0.25}
                  width={80}
                  defaultValue={num(rule?.requireDaysWorkedMinDailyHours, 0)}
                  unit="hours"
                  aria-label="Hours for a day to count"
                />
              </span>
            </span>
          </span>
        </Row>
        <Row label="Scheduled hours">
          <span className="flex flex-wrap items-center gap-2" style={words}>
            <Tick name="requireScheduledHoursPct" checked={pct} onChange={setPct} label="Must work at least" />
            <Num name="requireScheduledHoursPctValue" min={0} max={100} width={72} defaultValue={rule?.requireScheduledHoursPctValue ?? 50} aria-label="Percent of scheduled hours" />
            <span>% of the scheduled hours on those days</span>
          </span>
        </Row>
        <Row label="Least hours in the period" hint="0 means none.">
          <Num name="minPeriodHours" min={0} step={0.5} defaultValue={hrs(rule?.minPeriodMinutes, 0)} unit="hours" aria-label="Least hours in the period" />
        </Row>
        <Row label="Days that do not count" hint="These weekdays are skipped when working out whether someone qualifies, such as finding the day before or after.">
          <span className="flex flex-wrap gap-x-4 gap-y-2">
            {DAYS.map((d, i) => (
              <Checkbox
                key={d}
                checked={excluded.includes(i)}
                onChange={(on) => setExcluded(on ? [...excluded, i].sort((a, b) => a - b) : excluded.filter((x) => x !== i))}
                label={d}
              />
            ))}
          </span>
          <input type="hidden" name="excludedWeekDays" value={excluded.join(",")} />
        </Row>
        <Row label="Skipping the day after" hint="Takes effect only on the holidays that allow it, in Company Setup.">
          <Tick name="bypassAfterEligibility" checked={bypass} onChange={setBypass} label="Allow some holidays to skip the day after requirement" />
        </Row>
        <Row label="Dynamic schedules" unused>
          <Tick name="useDynamicSchedules" checked={dynamic} onChange={setDynamic} label="Look at every dynamic schedule on the day" />
        </Row>
      </Section>

      {/* ── Other rules ── */}
      <Section id="other" title="Other rules" hint="What happens to hours worked on the holiday itself.">
        <Row label="Working the holiday">
          <Tick name="payNonWorkingHolidayOnly" checked={nonWorkingOnly} onChange={setNonWorkingOnly} label="Pay holiday hours only to those who do not work it" />
        </Row>
        <Row label="Hours worked on the holiday">
          <span className="flex flex-col gap-2.5">
            <span className="flex flex-wrap items-center gap-2" style={words}>
              <Tick name="postWorkingHoursToAccrual" checked={toAccrual} onChange={setToAccrual} label="Add them to a leave balance, up to" />
              <Num name="postWorkingHoursMax" min={0} step={0.25} width={80} defaultValue={num(rule?.postWorkingHoursMax, 0)} unit="hours" aria-label="Most hours added" />
            </span>
            <span hidden={!toAccrual} className="flex flex-col gap-2.5 pl-6">
              <span className="flex flex-wrap items-center gap-2" style={words}>
                <Tick name="postWorkingHoursExcessEnabled" checked={excessOn} onChange={setExcessOn} label="Only the hours over" />
                <Num name="postWorkingHoursExcessMin" min={0} step={0.25} width={80} defaultValue={num(rule?.postWorkingHoursExcessMin, 0)} unit="hours" aria-label="Only hours over" />
              </span>
              <span className="flex flex-wrap items-center gap-2" style={words}>
                <span>Balance code</span>
                <span style={{ width: 140 }}>
                  <Input name="accrualCode" defaultValue={rule?.accrualCode ?? ""} placeholder="VAC" aria-label="Balance code" />
                </span>
              </span>
            </span>
          </span>
        </Row>
        <Row label="Attendance pay codes" unused>
          <Tick name="includeNonCalcAttendance" checked={nonCalc} onChange={setNonCalc} label="Count pay codes that are not calculated but count as attendance" />
        </Row>
      </Section>

      {/* ── Holidays it pays ── */}
      <Section id="holidays" title="Holidays it pays" hint="The dates are picked on each holiday in Company Setup.">
        {holidays.length === 0 ? (
          <p className="px-5 pb-4" style={{ margin: 0, ...caption, borderTop: "1px solid var(--stroke-divider)", paddingTop: 14 }}>
            No holidays yet. Open a holiday in Company Setup and pick this rule.
          </p>
        ) : (
          holidays.map(({ holiday: h }) => {
            const d = typeof h.date === "string" ? parseISO(h.date) : h.date;
            const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            return (
              <div key={h.id} className="flex items-center gap-4 px-5 py-2.5" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
                <span className="tabular w-[150px] flex-none" style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                  {format(local, "EEE, MMM d, yyyy")}
                </span>
                <span className="min-w-0 truncate" style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}>
                  {h.name}
                </span>
              </div>
            );
          })
        )}
        <div className="px-5 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
          <Link href="/admin/site-settings?tab=holidays" style={{ font: "var(--type-body2)", color: "var(--text-accent)" }}>
            Holidays in Company Setup
          </Link>
        </div>
      </Section>

      {/* ── Overrides ── */}
      <Section
        id="overrides"
        title="Overrides"
        hint="A different number of hours, or pay code, for particular dates."
        on={overridesOn}
        onToggle={setOverridesOn}
        offText="Off. Every holiday pays the same."
      >
        {rows.map((o, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--stroke-divider)", ...words }}>
            <span style={{ width: 170 }}>
              <Input type="date" value={o.date} onChange={(e) => setRow(i, { date: e.target.value })} aria-label={`Override ${i + 1} date`} />
            </span>
            <span>pays</span>
            <Num value={o.hours} onChange={(e) => setRow(i, { hours: e.target.value })} min={0} step={0.001} width={96} unit="hours on" aria-label={`Override ${i + 1} hours`} />
            <PayCodeSelect value={o.payCodeId} onChange={(v) => setRow(i, { payCodeId: v })} payCodes={payCodes} ariaLabel={`Override ${i + 1} pay code`} width={240} />
            <Button hierarchy="tertiary" size="sm" iconOnly aria-label={`Remove override ${i + 1}`} onClick={() => setOverrides(rows.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="px-5 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
          <Button
            hierarchy="secondary"
            size="sm"
            leadingIcon={<Plus className="h-4 w-4" />}
            disabled={rows.length >= 10}
            onClick={() => setOverrides([...rows, { date: "", hours: "0.000", payCodeId: "" }])}
          >
            Add an override
          </Button>
        </div>
        <Row label="Birthdays">
          <Tick name="birthdayIsHoliday" checked={birthday} onChange={setBirthday} label="Each employee's birthday counts as a holiday" />
        </Row>
      </Section>
      <input type="hidden" name="holidayOverridesEnabled" value={overridesOn ? "true" : "false"} />
      <input type="hidden" name="holidayOverrides" value={JSON.stringify(overrides)} />

      {/* ── Proration ── */}
      <Section
        id="prorate"
        title="Proration"
        hint="Pays part of the holiday to people who worked fewer hours in the weeks before it."
        on={prorate}
        onToggle={setProrate}
        offText="Off. Everyone who qualifies gets the full holiday pay."
      >
        <Row label="Hours looked at">
          <span className="flex flex-col gap-2.5">
            <ChoiceField
              label=""
              name="prorateUseCustomRange"
              defaultValue={customRange ? "true" : "false"}
              onChange={(v) => setCustomRange(v === "true")}
              options={[
                { value: "false", label: "The days before it" },
                { value: "true", label: "A custom range" },
              ]}
            />
            <span className="flex flex-wrap items-center gap-2" style={words}>
              <span>The last</span>
              <Num name="prorateLookbackDays" min={1} max={365} width={72} defaultValue={rule?.prorateLookbackDays ?? 28} unit="days," aria-label="Days looked back" />
              <Select name="prorateIncludeCurrentWeek" defaultValue={rule?.prorateIncludeCurrentWeek !== false ? "true" : "false"} aria-label="This week" style={{ width: 200 }}>
                <option value="true">including this week</option>
                <option value="false">not including this week</option>
              </Select>
            </span>
            {customRange && (
              <span style={caption}>A custom range is saved, but pay is still worked out from the days above.</span>
            )}
          </span>
        </Row>
        <Row label="What is paid">
          <span className="flex flex-col gap-3">
            <ChoiceField
              label=""
              name="prorateAppliedRule"
              defaultValue={applied}
              onChange={setApplied}
              options={[
                { value: "AVERAGE_DAILY", label: "The average day" },
                { value: "THRESHOLD", label: "Full pay above a number of hours" },
              ]}
            />
            <span hidden={applied !== "AVERAGE_DAILY"} className="flex flex-wrap items-center gap-2" style={words}>
              <span>The average hours worked a day, up to</span>
              <Num name="prorateAverageDailyMaxHours" min={0} max={24} step={0.001} width={96} defaultValue={num(rule?.prorateAverageDailyMaxHours, 8)} unit="hours" aria-label="Most average hours" />
            </span>
            <span hidden={applied !== "THRESHOLD"} className="flex flex-col gap-2" style={words}>
              <span className="flex flex-wrap items-center gap-2">
                <span>Full holiday pay at</span>
                <Num name="prorateThresholdHours" min={0} step={0.001} width={96} defaultValue={num(rule?.prorateThresholdHours, 0)} unit="hours worked or more." aria-label="Hours for full pay" />
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span>Below that, the hours worked times</span>
                <Num name="prorateMultiplier" min={0} step={0.0000001} width={128} defaultValue={num(rule?.prorateMultiplier, 0)} aria-label="Multiplier" />
              </span>
            </span>
          </span>
        </Row>
        <Row label="Overtime">
          <Tick name="prorateExcludeOt" checked={excludeOt} onChange={setExcludeOt} label="Leave overtime out of the hours worked" />
        </Row>
      </Section>
      <input type="hidden" name="prorateEnabled" value={prorate ? "true" : "false"} />

      {rule && (
        <DeleteSection
          title="Delete holiday rule"
          reason={
            people > 0
              ? `${people.toLocaleString()} ${people === 1 ? "employee is" : "employees are"} on it, so it cannot be deleted. Set it to inactive instead.`
              : holidays.length
                ? `Nobody is on this rule. Deleting it also stops it paying its ${holidays.length} ${holidays.length === 1 ? "holiday" : "holidays"}, and cannot be undone.`
                : "Nobody is on this rule. Deleting it cannot be undone."
          }
        >
          {people === 0 && <DeleteAction label="Delete holiday rule" question="Delete this rule for good?" pending={isPending} onDelete={remove} />}
        </DeleteSection>
      )}
    </EditorPage>
  );
}
