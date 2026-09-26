"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { useRouter } from "@/components/layout/navigation-progress";
import { createPtoPolicy, updatePtoPolicy, deletePtoPolicy } from "@/actions/pto-policy.actions";
import { Banner, Button, Input, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { DeleteSection, EditorPage, Num, Row, Section, Tick, jumpToSection, words, type EditorGroup } from "./setup/editor-page";
import { ChoiceField, DeleteAction, StatusBadge, StatusField, saveError } from "./setup/setup-ui";

/**
 * A leave policy, edited on a page of its own: the leave type it earns, how
 * often time posts, the tenure tiers, and what happens at a balance reset.
 *
 * <p>The old window rebuilt every tier on save, even when nobody touched
 * them: each tier took the first tier's pay code and carry over leave type,
 * levels had their end month recomputed and their yearly bonus set to 0,
 * and a policy from before one leave type per policy had all its tiers
 * moved onto one leave type. Settings behind a switch that was off were
 * sent empty. Now the tiers are only sent once changed, a value behind a
 * switch stays as it was, and where tiers differ the page says so.
 */

type Freq =
  | "PER_PAY_PERIOD"
  | "DAILY"
  | "WEEKLY"
  | "BI_WEEKLY"
  | "SEMI_MONTHLY"
  | "MONTHLY"
  | "EVERY_2_MONTHS"
  | "QUARTERLY"
  | "EVERY_4_MONTHS"
  | "SEMI_ANNUALLY"
  | "ANNUALLY"
  | "ANNUALLY_HIRE"
  | "ANNUALLY_FIXED";
type Basis = "HIRE_DATE" | "ADJUSTED_HIRE_DATE" | "TITLE_CHANGE_DATE" | "ORIENTATION_DATE" | "USER_DATE_2";

export type PolicyRule = {
  leaveTypeId: string;
  minTenureMonths: number;
  maxTenureMonths: number | null;
  annualHours: number;
  earnedHoursPerYear: number;
  carryOverHours: number | null;
  carryOverToLeaveTypeId: string | null;
  maxAnnualHours: number | null;
  maxBalanceHours: number | null;
  payCodeId: string | null;
};

export type PolicyRow = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  leaveTypeId: string | null;
  leaveType?: { id: string; name: string } | null;
  rateMode: "YEARLY" | "PER_POSTING";
  serviceMonthBasis: Basis;
  postingAnchorDate: string | null;
  posting1Freq: Freq;
  posting1Month: number | null;
  posting1Day: number | null;
  dualPosting: boolean;
  posting2Freq: Freq | null;
  posting2Month: number | null;
  posting2Day: number | null;
  posting2ServiceMonthBasis: Basis | null;
  posting2AnchorDate: string | null;
  posting2StartsOnYear: number | null;
  posting2BasedOnMonths: boolean;
  balanceReset: boolean;
  resetMonth: number | null;
  resetDay: number | null;
  maxDailyHours: number | null;
  allowNegativeBalance: boolean;
  maxNegativeHours: number | null;
  carryOverEnabled: boolean;
  carryOverRespectMaxBalance: boolean;
  forecastEnabled: boolean;
  forecastMode: string | null;
  forecastMonths: number | null;
  forecastApplyToAvailable: boolean;
  rules: (PolicyRule & { id?: string })[];
  _count?: { siteLinks: number; categoryLinks: number };
};

type LeaveTypeOption = { id: string; name: string };
type PayCodeOption = { id: string; code: number; label: string; isActive?: boolean };

export const FREQ_LABEL: Record<Freq, string> = {
  PER_PAY_PERIOD: "Every pay period",
  DAILY: "Every day",
  WEEKLY: "Every week",
  BI_WEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Every month",
  EVERY_2_MONTHS: "Every 2 months",
  QUARTERLY: "Every quarter",
  EVERY_4_MONTHS: "Every 4 months",
  SEMI_ANNUALLY: "Twice a year",
  ANNUALLY: "Once a year",
  ANNUALLY_HIRE: "Once a year on the hire date (older setting)",
  ANNUALLY_FIXED: "Once a year on a set date (older setting)",
};
const OFFERED: Freq[] = [
  "PER_PAY_PERIOD",
  "DAILY",
  "WEEKLY",
  "BI_WEEKLY",
  "SEMI_MONTHLY",
  "MONTHLY",
  "EVERY_2_MONTHS",
  "QUARTERLY",
  "EVERY_4_MONTHS",
  "SEMI_ANNUALLY",
  "ANNUALLY",
];
const BASIS_LABEL: Record<Basis, string> = {
  HIRE_DATE: "Hire date",
  ADJUSTED_HIRE_DATE: "Adjusted hire date",
  TITLE_CHANGE_DATE: "Title change date",
  ORIENTATION_DATE: "Orientation date",
  USER_DATE_2: "User date 2",
};
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const VARIES = "__varies";
const caption = { font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" } as const;
const dateOnly = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function FreqSelect({ value, onChange, label }: { value: Freq; onChange: (v: Freq) => void; label: string }) {
  const options = OFFERED.includes(value) ? OFFERED : [...OFFERED, value];
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as Freq)} aria-label={label} style={{ width: 300, maxWidth: "100%" }}>
      {options.map((f) => (
        <option key={f} value={f}>
          {FREQ_LABEL[f]}
        </option>
      ))}
    </Select>
  );
}

function MonthDay({
  month,
  day,
  onMonth,
  onDay,
  label,
}: {
  month: number | null;
  day: number | null;
  onMonth: (v: number | null) => void;
  onDay: (v: number | null) => void;
  label: string;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2" style={words}>
      <Select value={month ?? ""} onChange={(e) => onMonth(e.target.value ? Number(e.target.value) : null)} aria-label={`${label} month`} style={{ width: 160 }}>
        <option value="">Month</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </Select>
      <Num value={day ?? ""} onChange={(e) => onDay(e.target.value ? parseInt(e.target.value, 10) : null)} min={1} max={31} width={72} placeholder="Day" aria-label={`${label} day`} />
    </span>
  );
}

export function LeavePolicyEditor({
  policy: p,
  leaveTypes,
  payCodes,
}: {
  policy: PolicyRow | null;
  leaveTypes: LeaveTypeOption[];
  payCodes: PayCodeOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const sites = p?._count?.siteLinks ?? 0;
  const categories = p?._count?.categoryLinks ?? 0;

  /* Tiers: kept exactly as stored until somebody changes one. */
  const [rules, setRulesRaw] = useState<PolicyRule[]>(() =>
    p?.rules?.length
      ? [...p.rules].sort((a, b) => a.minTenureMonths - b.minTenureMonths).map((r) => r as PolicyRule)
      : [
          {
            leaveTypeId: leaveTypes[0]?.id ?? "",
            minTenureMonths: 0,
            maxTenureMonths: null,
            annualHours: 0,
            earnedHoursPerYear: 0,
            carryOverHours: null,
            carryOverToLeaveTypeId: null,
            maxAnnualHours: null,
            maxBalanceHours: null,
            payCodeId: null,
          },
        ],
  );
  const [tiersTouched, setTiersTouched] = useState(!p);
  const setRules = (next: PolicyRule[]) => (setRulesRaw(next), setTiersTouched(true));
  const [rateMode, setRateModeRaw] = useState<"YEARLY" | "PER_POSTING">(p?.rateMode ?? "PER_POSTING");
  const setRateMode = (v: "YEARLY" | "PER_POSTING") => (setRateModeRaw(v), setTiersTouched(true));

  // One value shown for the whole policy, or "varies" when the tiers differ.
  const shared = (k: "leaveTypeId" | "payCodeId" | "carryOverToLeaveTypeId") => {
    const set = new Set(rules.map((r) => r[k] ?? ""));
    return set.size === 1 ? [...set][0] : VARIES;
  };
  const [leaveTypeId, setLeaveTypeIdRaw] = useState<string>(p?.leaveTypeId ?? (shared("leaveTypeId") === VARIES ? VARIES : shared("leaveTypeId")));
  // A policy from before one leave type per policy keeps its blank until one is picked.
  const [ltTouched, setLtTouched] = useState(false);
  const setLeaveTypeId = (v: string) => (setLeaveTypeIdRaw(v), setLtTouched(true));
  const severalTypes = leaveTypeId === VARIES;
  const setAll = (k: "leaveTypeId" | "payCodeId" | "carryOverToLeaveTypeId", v: string) =>
    setRules(rules.map((r) => ({ ...r, [k]: v || null })) as PolicyRule[]);

  const [dual, setDual] = useState(p?.dualPosting ?? false);
  const [freq1, setFreq1] = useState<Freq>(p?.posting1Freq ?? "PER_PAY_PERIOD");
  const [m1, setM1] = useState<number | null>(p?.posting1Month ?? null);
  const [d1, setD1] = useState<number | null>(p?.posting1Day ?? null);
  const [freq2, setFreq2] = useState<Freq>(p?.posting2Freq ?? "ANNUALLY");
  const [m2, setM2] = useState<number | null>(p?.posting2Month ?? null);
  const [d2, setD2] = useState<number | null>(p?.posting2Day ?? null);
  const [basedOnMonths, setBasedOnMonths] = useState(p?.posting2BasedOnMonths ?? false);
  const [reset, setReset] = useState(p?.balanceReset ?? false);
  const [rm, setRm] = useState<number | null>(p?.resetMonth ?? null);
  const [rd, setRd] = useState<number | null>(p?.resetDay ?? null);
  const [carryOn, setCarryOn] = useState(p?.carryOverEnabled ?? true);
  const [respectMax, setRespectMax] = useState(p?.carryOverRespectMaxBalance ?? false);
  const [borrow, setBorrow] = useState(p?.allowNegativeBalance ?? false);
  const [forecast, setForecast] = useState(p?.forecastEnabled ?? false);
  // Blank stays blank until picked: a policy with no forecast mode saves none.
  const [forecastMode, setForecastMode] = useState<string | null>(p ? p.forecastMode : "END_OF_YEAR");
  const [applyForecast, setApplyForecast] = useState(p?.forecastApplyToAvailable ?? false);

  const payCodeShared = shared("payCodeId");
  const carryShared = shared("carryOverToLeaveTypeId");
  const levels = rateMode === "PER_POSTING";

  /** The tiers as the server stores them; levels end where the next starts. */
  function tiersToSend(): PolicyRule[] {
    return rules.map((r, i) => ({
      ...r,
      leaveTypeId: severalTypes ? r.leaveTypeId : leaveTypeId,
      ...(levels ? { earnedHoursPerYear: 0, maxTenureMonths: i < rules.length - 1 ? rules[i + 1].minTenureMonths : null } : {}),
    }));
  }

  function addTier() {
    const last = rules[rules.length - 1];
    const template = { ...(last ?? rules[0]), annualHours: 0, earnedHoursPerYear: 0, carryOverHours: null, maxAnnualHours: null, maxBalanceHours: null };
    if (levels) return setRules([...rules, { ...template, minTenureMonths: (last?.minTenureMonths ?? 0) + 12, maxTenureMonths: null }]);
    const closed = last?.maxTenureMonths ?? (last?.minTenureMonths ?? 0) + 12;
    const head = last && last.maxTenureMonths == null ? [...rules.slice(0, -1), { ...last, maxTenureMonths: closed }] : rules;
    setRules([...head, { ...template, minTenureMonths: closed, maxTenureMonths: null }]);
  }
  const updateTier = (i: number, patch: Partial<PolicyRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const groups: EditorGroup[] = [
    { title: "Basics", areas: [{ id: "general", label: "General" }] },
    {
      title: "Earning",
      areas: [
        { id: "posting", label: "Posting", count: dual ? "Twice" : undefined },
        { id: "tiers", label: levels ? "Levels" : "Tiers", count: String(rules.length) },
      ],
    },
    {
      title: "Balance",
      areas: [
        { id: "reset", label: "Balance reset", count: reset ? "On" : "Off" },
        { id: "borrow", label: "Borrowing", count: borrow ? "On" : "Off" },
        { id: "forecast", label: "Forecast", count: forecast ? "On" : "Off" },
      ],
    },
  ];
  if (p) groups.push({ title: "Other", areas: [{ id: "delete", label: "Delete policy" }] });

  /** What a save sends, in the shape the actions take. */
  function build(fd: FormData) {
    const name = ((fd.get("name") as string) ?? "").trim();
    const maxDaily = fd.get("maxDailyHours") as string;
    const maxNeg = fd.get("maxNegativeHours") as string;
    const months = fd.get("forecastMonths") as string;
    const startsOn = fd.get("posting2StartsOnYear") as string;
    const common = {
      name,
      isDefault: fd.get("isDefault") === "true",
      maxDailyHours: numOrNull(maxDaily ?? ""),
      allowNegativeBalance: borrow,
      maxNegativeHours: numOrNull(maxNeg ?? ""),
      carryOverEnabled: carryOn,
      carryOverRespectMaxBalance: respectMax,
      forecastEnabled: forecast,
      forecastMode: (forecastMode || null) as "MONTHS" | "END_OF_YEAR" | null,
      forecastMonths: months ? parseInt(months, 10) : null,
      forecastApplyToAvailable: applyForecast,
      rateMode,
      serviceMonthBasis: fd.get("serviceMonthBasis") as Basis,
      postingAnchorDate: (fd.get("postingAnchorDate") as string) || null,
      posting1Freq: freq1,
      posting1Month: m1,
      posting1Day: d1,
      dualPosting: dual,
      posting2Freq: dual ? freq2 : p ? p.posting2Freq : null,
      posting2Month: m2,
      posting2Day: d2,
      posting2ServiceMonthBasis: ((fd.get("posting2ServiceMonthBasis") as string) || null) as Basis | null,
      posting2AnchorDate: (fd.get("posting2AnchorDate") as string) || null,
      posting2StartsOnYear: startsOn ? parseInt(startsOn, 10) : null,
      posting2BasedOnMonths: basedOnMonths,
      balanceReset: reset,
      resetMonth: rm,
      resetDay: rd,
    };
    const create = {
      ...common,
      description: ((fd.get("description") as string) ?? "").trim() || undefined,
      leaveTypeId,
      rules: tiersToSend(),
    };
    const update = p
      ? {
          ...common,
          ptoPolicyId: p.id,
          description: ((fd.get("description") as string) ?? "").trim() || null,
          isActive: fd.get("isActive") === "true",
          ...(severalTypes || (p.leaveTypeId == null && !ltTouched) ? {} : { leaveTypeId }),
          ...(tiersTouched ? { rules: tiersToSend() } : {}),
        }
      : null;
    return { name, create, update };
  }


  function onSubmit(form: HTMLFormElement) {
    const { name, create, update } = build(new FormData(form));
    if (!name) {
      jumpToSection("general");
      return setError("Give the policy a name.");
    }
    if (!p && (severalTypes || !leaveTypeId)) {
      jumpToSection("general");
      return setError("Pick the leave type this policy earns.");
    }
    setError(null);
    startTransition(async () => {
      if (!p || !update) {
        const result = await createPtoPolicy(create);
        if (!result.success) return setError(saveError(result.error));
        setSavedCount((c) => c + 1);
        router.replace(`/admin/rules-setup/leave-policies/${result.data.id}`);
        return;
      }
      const result = await updatePtoPolicy(update);
      if (!result.success) return setError(saveError(result.error));
      setSavedCount((c) => c + 1);
      router.refresh();
    });
  }

  function remove() {
    if (!p) return;
    setError(null);
    startTransition(async () => {
      const result = await deletePtoPolicy({ ptoPolicyId: p.id });
      if (!result.success) return setError(saveError(result.error));
      setSavedCount((c) => c + 1);
      router.push("/admin/rules-setup?tab=leave-policies");
    });
  }

  const leaveTypeName = (id: string | null) => leaveTypes.find((l) => l.id === id)?.name;

  return (
    <EditorPage
      noun="leave policy"
      title={p ? p.name : "New leave policy"}
      subtitle={
        p ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{p.leaveType?.name ?? (severalTypes ? "Several leave types" : "No leave type")}</span>
            <span aria-hidden="true">·</span>
            <span>
              {sites} {sites === 1 ? "site" : "sites"}, {categories} pay {categories === 1 ? "category" : "categories"}
            </span>
            <StatusBadge active={p.isActive} />
          </span>
        ) : (
          "How a leave balance is earned and kept"
        )
      }
      back={{ href: "/admin/rules-setup?tab=leave-policies", label: "Leave policies" }}
      groups={groups}
      isNew={!p}
      submitLabel={p ? "Save changes" : "Add leave policy"}
      pending={isPending}
      error={error}
      savedCount={savedCount}
      onSubmit={onSubmit}
    >
      {/* What the changed check compares: state that lives outside named fields. */}
      <input type="hidden" name="_state" value={JSON.stringify({ rules, rateMode, leaveTypeId, dual, freq1, m1, d1, freq2, m2, d2, basedOnMonths, reset, rm, rd, carryOn, respectMax, borrow, forecast, forecastMode, applyForecast })} />

      {/* ── General ── */}
      <Section id="general" title="General" hint="What the policy is called, and the leave type it earns.">
        <Row label="Name">
          <span className="w-full max-w-[420px]">
            <Input name="name" required defaultValue={p?.name ?? ""} placeholder="Full time paid time off" aria-label="Name" />
          </span>
        </Row>
        <Row label="Description" hint="Optional.">
          <span className="w-full max-w-[520px]">
            <Input name="description" maxLength={500} defaultValue={p?.description ?? ""} aria-label="Description" />
          </span>
        </Row>
        <Row label="Leave type">
          <span className="flex w-full flex-col gap-2">
            <Select
              value={leaveTypeId}
              onChange={(e) => {
                setLeaveTypeId(e.target.value);
                setAll("leaveTypeId", e.target.value);
              }}
              aria-label="Leave type"
              style={{ width: 280, maxWidth: "100%" }}
            >
              {severalTypes && <option value={VARIES}>Several leave types</option>}
              {!p && !leaveTypeId && <option value="">Choose a leave type</option>}
              {leaveTypes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            {severalTypes && (
              <span style={caption}>
                This policy is from before one leave type per policy, and its tiers cover {new Set(rules.map((r) => r.leaveTypeId)).size} leave types. Picking one here moves every tier onto it.
              </span>
            )}
          </span>
        </Row>
        <Row label="Pay code" hint="Optional. The timecard line this leave is posted to.">
          <Select
            value={payCodeShared}
            onChange={(e) => setAll("payCodeId", e.target.value)}
            aria-label="Pay code"
            style={{ width: 280, maxWidth: "100%" }}
          >
            {payCodeShared === VARIES && <option value={VARIES}>Differs by tier</option>}
            <option value="">No pay code</option>
            {payCodes
              .filter((c) => c.isActive !== false || rules.some((r) => r.payCodeId === c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.label}
                </option>
              ))}
          </Select>
        </Row>
        <Row label="Company default" hint="Used when nothing else gives someone a policy for this leave type.">
          <ChoiceField
            label=""
            name="isDefault"
            defaultValue={p?.isDefault ? "true" : "false"}
            options={[
              { value: "false", label: "No" },
              { value: "true", label: "Default" },
            ]}
          />
        </Row>
        {p && (
          <Row label="Status" hint="An inactive policy can no longer be picked for a site.">
            <StatusField defaultActive={p.isActive} bare />
          </Row>
        )}
        <Row label="Most hours a day" hint="A request for more than this on one day is refused. Blank means no limit.">
          <Num name="maxDailyHours" min={0.25} max={24} step={0.25} defaultValue={p?.maxDailyHours ?? ""} placeholder="No limit" unit="hours" aria-label="Most hours a day" />
        </Row>
      </Section>

      {/* ── Posting ── */}
      <Section id="posting" title="Posting" hint="How often earned time is added to balances, and the date tenure is counted from.">
        <Row label="Tenure counted from" hint="Also sets each person's anniversary for yearly postings.">
          <Select name="serviceMonthBasis" defaultValue={p?.serviceMonthBasis ?? "HIRE_DATE"} aria-label="Tenure counted from" style={{ width: 240 }}>
            {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => (
              <option key={b} value={b}>
                {BASIS_LABEL[b]}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Time is added">
          <span className="flex flex-col gap-2">
            <FreqSelect value={freq1} onChange={setFreq1} label="How often time is added" />
            {freq1 === "ANNUALLY_FIXED" && <MonthDay month={m1} day={d1} onMonth={setM1} onDay={setD1} label="Posting date" />}
          </span>
        </Row>
        <Row label="Counted from" hint="Optional. A date a weekly or 2 week cycle starts on. Blank uses the calendar.">
          <span style={{ width: 180 }}>
            <Input name="postingAnchorDate" type="date" defaultValue={dateOnly(p?.postingAnchorDate)} aria-label="Posting cycle starts on" />
          </span>
        </Row>
        <Row label="A second posting">
          <Tick checked={dual} onChange={setDual} label="Also add time on a second schedule" />
        </Row>
        <div hidden={!dual}>
          <Row label="Second schedule">
            <span className="flex flex-col gap-2">
              <FreqSelect value={freq2} onChange={setFreq2} label="How often the second posting adds time" />
              {freq2 === "ANNUALLY_FIXED" && <MonthDay month={m2} day={d2} onMonth={setM2} onDay={setD2} label="Second posting date" />}
            </span>
          </Row>
          <Row label="Starts on the" unused>
            <span className="flex flex-wrap items-center gap-2" style={words}>
              <Num name="posting2StartsOnYear" min={1} max={99} width={72} defaultValue={p?.posting2StartsOnYear ?? ""} placeholder="1" aria-label="Starts on" />
              <span>{basedOnMonths ? "month" : "calendar year"}</span>
              <Tick checked={basedOnMonths} onChange={setBasedOnMonths} label="Count in months" />
            </span>
          </Row>
          <Row label="Its tenure counted from" unused>
            <Select name="posting2ServiceMonthBasis" defaultValue={p?.posting2ServiceMonthBasis ?? ""} aria-label="Second posting tenure counted from" style={{ width: 240 }}>
              <option value="">Same as the first</option>
              {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => (
                <option key={b} value={b}>
                  {BASIS_LABEL[b]}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Its reference date" unused>
            <span style={{ width: 180 }}>
              <Input name="posting2AnchorDate" type="date" defaultValue={dateOnly(p?.posting2AnchorDate)} aria-label="Second posting reference date" />
            </span>
          </Row>
        </div>
      </Section>

      {/* ── Tiers ── */}
      <Section
        id="tiers"
        title={levels ? "Levels" : "Tiers"}
        hint={
          levels
            ? "The hours added at each posting, by how long someone has worked here. Each level runs until the next one starts."
            : "The hours earned in a year, by how long someone has worked here. They are spread across the postings."
        }
      >
        <Row label="Hours are entered as">
          <ChoiceField
            label=""
            name="_rateMode"
            defaultValue={rateMode}
            onChange={(v) => setRateMode(v as "YEARLY" | "PER_POSTING")}
            options={[
              { value: "PER_POSTING", label: "Hours each posting" },
              { value: "YEARLY", label: "Hours a year" },
            ]}
          />
        </Row>
        {payCodeShared === VARIES || carryShared === VARIES || severalTypes ? (
          <div className="px-5 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
            <Banner
              tone="info"
              title="The tiers differ"
              body="Some tiers have their own leave type, pay code or carry over. They stay that way unless you change it for the whole policy."
            />
          </div>
        ) : null}
        <div style={{ borderTop: "1px solid var(--stroke-divider)" }}>
          <Table>
            <THead>
              <TR>
                <TH style={{ width: 56 }}>{levels ? "Level" : "Tier"}</TH>
                <TH>{levels ? "Starts at month" : "Months worked"}</TH>
                <TH>{levels ? "Hours each posting" : "Hours a year"}</TH>
                {!levels && <TH>More each year</TH>}
                <TH>Carry over</TH>
                <TH>Most used a year</TH>
                <TH>Most held</TH>
                <TH style={{ width: 44 }} aria-label="Remove" />
              </TR>
            </THead>
            <TBody>
              {rules.map((r, i) => (
                <TR key={i}>
                  <TD style={{ fontWeight: "var(--weight-medium)", color: "var(--text-secondary)" }}>{i + 1}</TD>
                  <TD>
                    <span className="flex items-center gap-1.5" style={words}>
                      <Num value={r.minTenureMonths} onChange={(e) => updateTier(i, { minTenureMonths: parseInt(e.target.value, 10) || 0 })} min={0} width={64} aria-label={`Tier ${i + 1} starts at month`} />
                      {!levels && (
                        <>
                          <span>to</span>
                          <Num
                            value={r.maxTenureMonths ?? ""}
                            onChange={(e) => updateTier(i, { maxTenureMonths: e.target.value ? parseInt(e.target.value, 10) : null })}
                            min={1}
                            width={64}
                            placeholder="Any"
                            aria-label={`Tier ${i + 1} ends at month`}
                          />
                        </>
                      )}
                    </span>
                  </TD>
                  <TD>
                    <Num value={r.annualHours || ""} onChange={(e) => updateTier(i, { annualHours: parseFloat(e.target.value) || 0 })} min={0} step={0.01} width={88} placeholder="0" aria-label={`Tier ${i + 1} hours`} />
                  </TD>
                  {!levels && (
                    <TD>
                      <Num value={r.earnedHoursPerYear || ""} onChange={(e) => updateTier(i, { earnedHoursPerYear: parseFloat(e.target.value) || 0 })} min={0} step={0.01} width={80} placeholder="0" aria-label={`Tier ${i + 1} more each year`} />
                    </TD>
                  )}
                  <TD>
                    <Num value={r.carryOverHours ?? ""} onChange={(e) => updateTier(i, { carryOverHours: e.target.value ? parseInt(e.target.value, 10) : null })} min={0} width={88} placeholder="All" aria-label={`Tier ${i + 1} carry over hours`} />
                  </TD>
                  <TD>
                    <Num value={r.maxAnnualHours ?? ""} onChange={(e) => updateTier(i, { maxAnnualHours: e.target.value ? parseFloat(e.target.value) : null })} min={0} step={0.5} width={88} placeholder="No limit" aria-label={`Tier ${i + 1} most used a year`} />
                  </TD>
                  <TD>
                    <Num value={r.maxBalanceHours ?? ""} onChange={(e) => updateTier(i, { maxBalanceHours: e.target.value ? parseFloat(e.target.value) : null })} min={0} step={0.5} width={88} placeholder="No limit" aria-label={`Tier ${i + 1} most held`} />
                  </TD>
                  <TD align="right">
                    {rules.length > 1 && (
                      <Button hierarchy="tertiary" size="sm" iconOnly aria-label={`Remove tier ${i + 1}`} onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
          <Button hierarchy="secondary" size="sm" leadingIcon={<Plus className="h-4 w-4" />} onClick={addTier}>
            {levels ? "Add a level" : "Add a tier"}
          </Button>
          <span style={caption}>A blank carry over keeps everything. A blank limit means no limit.</span>
        </div>
      </Section>

      {/* ── Balance reset ── */}
      <Section
        id="reset"
        title="Balance reset"
        hint="Sets balances back to 0 on one date each year. If time is also added that day, the reset comes first."
        on={reset}
        onToggle={setReset}
        offText="Off. Balances keep growing from year to year."
      >
        <Row label="Resets on">
          <MonthDay month={rm} day={rd} onMonth={setRm} onDay={setRd} label="Reset" />
        </Row>
        <Row label="Unused time">
          <span className="flex flex-col gap-2.5">
            <Tick checked={carryOn} onChange={setCarryOn} label="Carry unused time forward, up to each tier's carry over" />
            <span hidden={!carryOn} className="flex flex-wrap items-center gap-2" style={words}>
              <span>Into</span>
              <Select
                value={carryShared}
                onChange={(e) => setAll("carryOverToLeaveTypeId", e.target.value)}
                aria-label="Carry unused time into"
                style={{ width: 240 }}
              >
                {carryShared === VARIES && <option value={VARIES}>Differs by tier</option>}
                <option value="">The same leave type</option>
                {leaveTypes
                  .filter((l) => l.id !== leaveTypeId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </Select>
            </span>
            <span hidden={!carryOn || !carryShared || carryShared === VARIES}>
              <Tick
                checked={respectMax}
                onChange={setRespectMax}
                label={`Stop at the most ${leaveTypeName(carryShared) ?? "that leave type"} can hold`}
              />
            </span>
          </span>
        </Row>
      </Section>

      {/* ── Borrowing ── */}
      <Section
        id="borrow"
        title="Borrowing"
        hint="Lets people request time off they have not earned yet, so their balance goes below 0."
        on={borrow}
        onToggle={setBorrow}
        offText="Off. A request can not take a balance below 0."
      >
        <Row label="Most borrowed" hint="Blank means no limit.">
          <Num name="maxNegativeHours" min={0.25} max={9999} step={0.25} defaultValue={p?.maxNegativeHours ?? ""} placeholder="No limit" unit="hours" aria-label="Most borrowed" />
        </Row>
      </Section>

      {/* ── Forecast ── */}
      <Section
        id="forecast"
        title="Forecast"
        hint="Works out the hours someone will have earned by a later date, and shows it with their balance."
        on={forecast}
        onToggle={setForecast}
        offText="Off. Balances show only what has been earned."
      >
        <Row label="Looking ahead to">
          <span className="flex flex-wrap items-center gap-3">
            <ChoiceField
              label=""
              name="_forecastMode"
              defaultValue={forecastMode ?? "END_OF_YEAR"}
              onChange={setForecastMode}
              options={[
                { value: "END_OF_YEAR", label: "The end of the year" },
                { value: "MONTHS", label: "A number of months" },
              ]}
            />
            <span hidden={forecastMode !== "MONTHS"}>
              <Num name="forecastMonths" min={1} max={120} width={72} defaultValue={p ? (p.forecastMonths ?? "") : 3} unit="months" aria-label="Months ahead" />
            </span>
          </span>
        </Row>
        <Row label="Available balance" hint="Otherwise the forecast is shown but a request can not use it.">
          <Tick checked={applyForecast} onChange={setApplyForecast} label="Count forecast hours as available" />
        </Row>
      </Section>

      {p && (
        <DeleteSection
          title="Delete leave policy"
          reason={
            sites || categories
              ? `It is on ${[sites ? `${sites} ${sites === 1 ? "site" : "sites"}` : "", categories ? `${categories} pay ${categories === 1 ? "category" : "categories"}` : ""].filter(Boolean).join(" and ")}, so it cannot be deleted. Set it to inactive instead.`
              : "Nothing uses this policy. Deleting it cannot be undone."
          }
        >
          {!sites && !categories && <DeleteAction label="Delete leave policy" question="Delete this policy for good?" pending={isPending} onDelete={remove} />}
        </DeleteSection>
      )}
    </EditorPage>
  );
}
