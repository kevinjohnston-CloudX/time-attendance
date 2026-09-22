"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, X, Trash2 } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { createPtoPolicy, updatePtoPolicy, deletePtoPolicy } from "@/actions/pto-policy.actions";
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
 * PTO policies — the list on the design's list template, the editor in a
 * dialog behind it.
 *
 * <p>The design's Policies list carries Rate, Waiting Period, Balance Cap and
 * Carryover as single values. A policy here is tiered: the rate and both caps
 * are per tenure level, so one number in a column would be whichever tier
 * happened to be first. The table shows how many tiers there are and how many
 * sites and employees the policy reaches — the figures that say whether a
 * change to it is small or company-wide.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

type AccrualPostingFreq =
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
type AccrualRateMode    = "YEARLY" | "PER_POSTING";
type ServiceMonthBasis =
  | "HIRE_DATE"
  | "ADJUSTED_HIRE_DATE"
  | "TITLE_CHANGE_DATE"
  | "ORIENTATION_DATE"
  | "USER_DATE_2";

type PostingConfig = {
  rateMode:          AccrualRateMode;
  serviceMonthBasis: ServiceMonthBasis;
  postingAnchorDate: string | null;
  posting1Freq:      AccrualPostingFreq;
  posting1Month: number | null;
  posting1Day:   number | null;
  dualPosting:   boolean;
  posting2Freq:  AccrualPostingFreq | null;
  posting2Month: number | null;
  posting2Day:   number | null;
  posting2ServiceMonthBasis: ServiceMonthBasis | null;
  posting2AnchorDate:        string | null;
  posting2StartsOnYear:      number | null;
  posting2BasedOnMonths:     boolean;
  balanceReset:  boolean;
  resetMonth:    number | null;
  resetDay:      number | null;
};

type Tier = {
  minTenureMonths: number;
  maxTenureMonths: number | null;
  annualHours: number;
  earnedHoursPerYear: number;
  carryOverHours:  number | null;
  maxAnnualHours:  number | null;
  maxBalanceHours: number | null;
};

// Flat rule as stored / sent to server
type Rule = Tier & { leaveTypeId: string; carryOverToLeaveTypeId: string | null; payCodeId: string | null };

type RuleFromServer = Rule & {
  id?: string;
  maxAnnualHours?: number | null;
  carryOverToLeaveTypeId?: string | null;
  payCodeId?: string | null;
  leaveType?: { id: string; name: string; category: string };
};

type PayCodeOption = { id: string; code: number; label: string; expressCode: string | null };

type Policy = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  leaveTypeId: string | null;
  leaveType: { id: string; name: string; category: string } | null;
  rateMode:          AccrualRateMode;
  serviceMonthBasis: ServiceMonthBasis;
  postingAnchorDate: Date | string | null;
  posting1Freq:      AccrualPostingFreq;
  posting1Month: number | null;
  posting1Day:   number | null;
  dualPosting:   boolean;
  posting2Freq:  AccrualPostingFreq | null;
  posting2Month: number | null;
  posting2Day:   number | null;
  posting2ServiceMonthBasis: ServiceMonthBasis | null;
  posting2AnchorDate:        Date | string | null;
  posting2StartsOnYear:      number | null;
  posting2BasedOnMonths:     boolean;
  balanceReset:  boolean;
  resetMonth:    number | null;
  resetDay:      number | null;
  maxDailyHours:              number | null;
  allowNegativeBalance:       boolean;
  maxNegativeHours:           number | null;
  carryOverEnabled:           boolean;
  carryOverRespectMaxBalance: boolean;
  forecastEnabled:          boolean;
  forecastMode:             string | null;
  forecastMonths:           number | null;
  forecastApplyToAvailable: boolean;
  rules: RuleFromServer[];
  _count: { siteLinks: number; empOverrides: number };
};

type LeaveTypeOption = { id: string; name: string; category: string };

interface Props { policies: Policy[]; leaveTypes: LeaveTypeOption[]; payCodes: PayCodeOption[]; initialPolicyId?: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultTier(minTenureMonths = 0): Tier {
  return { minTenureMonths, maxTenureMonths: null, annualHours: 0, earnedHoursPerYear: 0, carryOverHours: null, maxAnnualHours: null, maxBalanceHours: null };
}

const FREQ_LABELS: Record<AccrualPostingFreq, string> = {
  PER_PAY_PERIOD:  "Per Pay Period",
  DAILY:           "Daily",
  WEEKLY:          "Weekly",
  BI_WEEKLY:       "Bi-Weekly",
  SEMI_MONTHLY:    "Semi-Monthly",
  MONTHLY:         "Monthly",
  EVERY_2_MONTHS:  "Every 2 Months",
  QUARTERLY:       "Quarterly",
  EVERY_4_MONTHS:  "Every 4 Months",
  SEMI_ANNUALLY:   "Semi-Annually",
  ANNUALLY:        "Annually",
  ANNUALLY_HIRE:   "Annually – Hire Date (legacy)",
  ANNUALLY_FIXED:  "Annually – Fixed Date (legacy)",
};

const SERVICE_MONTH_BASIS_LABELS: Record<ServiceMonthBasis, string> = {
  HIRE_DATE:          "Hire Date",
  ADJUSTED_HIRE_DATE: "Adjusted Hire Date",
  TITLE_CHANGE_DATE:  "Title Change Date",
  ORIENTATION_DATE:   "Orientation Date",
  USER_DATE_2:        "User Date 2",
};

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

type View = "all" | "active" | "inactive";

const VIEWS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/** Field grid from the design's doc template, at two columns. */
const FIELD_GRID = "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,48%)),1fr))]";

// ─── Shared form pieces ───────────────────────────────────────────────────────

/**
 * A control sized to sit in a grid cell or beside a word.
 *
 * <p>The tier grid is six numbers across; the kit's 32px labelled field in
 * every cell would make one tier as tall as the dialog.
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

/** The select half of the same pair. */
function InlineSelect({ children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <Select {...rest} style={{ height: 26, font: "var(--type-body2)", padding: "0 6px" }}>
      {children}
    </Select>
  );
}

/** A labelled Select, matching the kit Input's label. */
function SelectField({
  label,
  hint,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      <Select {...rest}>{children}</Select>
      {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{hint}</span>}
    </label>
  );
}

/** A small labelled control for the two-up sub-grids. */
function SmallField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1">
      <span className="wms-overline">{label}</span>
      {children}
    </label>
  );
}

/** A section inside the dialog, where a nested Card would be a panel on a panel. */
function FormSection({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="wms-overline">{label}</span>
      {children}
      {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" }}>{hint}</span>}
    </section>
  );
}

/** A bordered group — one rule of the policy, with everything it switches on. */
function Panel({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section
      className="flex flex-col gap-3 rounded-xl px-4 py-3"
      style={{ border: "1px solid var(--stroke-secondary)" }}
    >
      <span className="wms-overline">{label}</span>
      {children}
      {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" }}>{hint}</span>}
    </section>
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

// ─── Posting frequency row ────────────────────────────────────────────────────

function PostingRow({
  label,
  freq,
  month,
  day,
  onFreqChange,
  onMonthChange,
  onDayChange,
}: {
  label: string;
  freq: AccrualPostingFreq | "";
  month: number | "";
  day: number | "";
  onFreqChange: (v: AccrualPostingFreq) => void;
  onMonthChange: (v: number | "") => void;
  onDayChange: (v: number | "") => void;
}) {
  return (
    <FormSection label={label}>
      <SelectField
        label="Posting Frequency"
        value={freq}
        onChange={(e) => onFreqChange(e.target.value as AccrualPostingFreq)}
      >
        <option value="PER_PAY_PERIOD">Per Pay Period</option>
        <option value="DAILY">Daily</option>
        <option value="WEEKLY">Weekly</option>
        <option value="BI_WEEKLY">Bi-Weekly</option>
        <option value="SEMI_MONTHLY">Semi-Monthly</option>
        <option value="MONTHLY">Monthly</option>
        <option value="EVERY_2_MONTHS">Every 2 Months</option>
        <option value="QUARTERLY">Quarterly</option>
        <option value="EVERY_4_MONTHS">Every 4 Months</option>
        <option value="SEMI_ANNUALLY">Semi-Annually</option>
        <option value="ANNUALLY">Annually</option>
      </SelectField>
      {/* The two legacy frequencies are not offered above; a policy already on
          ANNUALLY_FIXED still needs its month and day editable. */}
      {freq === "ANNUALLY_FIXED" && (
        <div className="grid gap-3 pl-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(140px,48%)),1fr))]">
          <SmallField label="Month">
            <InlineSelect
              value={month}
              onChange={(e) => onMonthChange(e.target.value !== "" ? parseInt(e.target.value, 10) : "")}
              style={{ width: "100%" }}
            >
              <option value="">-- select --</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </InlineSelect>
          </SmallField>
          <SmallField label="Day">
            <InlineInput
              type="number" min="1" max="31" step="1"
              value={day}
              onChange={(e) => onDayChange(e.target.value !== "" ? parseInt(e.target.value, 10) : "")}
              placeholder="1–31"
              width="100%"
            />
          </SmallField>
        </div>
      )}
    </FormSection>
  );
}

// ─── Policy form ──────────────────────────────────────────────────────────────

function PolicyForm({ leaveTypes, payCodes, initial, isPending, onSubmit, onCancel }: {
  leaveTypes: LeaveTypeOption[];
  payCodes: PayCodeOption[];
  initial?: Policy;
  isPending: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>, rules: Rule[], posting: PostingConfig) => void;
  onCancel: () => void;
}) {
  const [leaveTypeId, setLeaveTypeId] = useState<string>(
    initial?.leaveTypeId ?? initial?.rules?.[0]?.leaveTypeId ?? leaveTypes[0]?.id ?? ""
  );
  const [tiers, setTiers] = useState<Tier[]>(() => {
    if (!initial?.rules?.length) return [defaultTier(0)];
    return [...initial.rules]
      .sort((a, b) => a.minTenureMonths - b.minTenureMonths)
      .map((r) => ({
        minTenureMonths:    r.minTenureMonths,
        maxTenureMonths:    r.maxTenureMonths,
        annualHours:        r.annualHours,
        earnedHoursPerYear: r.earnedHoursPerYear,
        carryOverHours:     r.carryOverHours,
        maxAnnualHours:     r.maxAnnualHours  ?? null,
        maxBalanceHours:    r.maxBalanceHours ?? null,
      }));
  });
  const [carryOverToLeaveTypeId, setCarryOverToLeaveTypeId] = useState<string | null>(
    initial?.rules?.[0]?.carryOverToLeaveTypeId ?? null
  );
  const [payCodeId, setPayCodeId] = useState<string | null>(
    initial?.rules?.[0]?.payCodeId ?? null
  );

  // Rate mode state
  const [rateMode, setRateMode] = useState<AccrualRateMode>(initial?.rateMode ?? "PER_POSTING");

  // Service month basis state
  const [serviceMonthBasis, setServiceMonthBasis] = useState<ServiceMonthBasis>(initial?.serviceMonthBasis ?? "HIRE_DATE");
  const [postingAnchorDate, setPostingAnchorDate] = useState<string>(
    initial?.postingAnchorDate ? new Date(initial.postingAnchorDate).toISOString().slice(0, 10) : ""
  );

  // Posting schedule state
  const [posting1Freq,  setPosting1Freq]  = useState<AccrualPostingFreq>(initial?.posting1Freq  ?? "PER_PAY_PERIOD");
  const [posting1Month, setPosting1Month] = useState<number | "">(initial?.posting1Month ?? "");
  const [posting1Day,   setPosting1Day]   = useState<number | "">(initial?.posting1Day   ?? "");
  const [dualPosting,   setDualPosting]   = useState<boolean>(initial?.dualPosting ?? false);
  const [posting2Freq,  setPosting2Freq]  = useState<AccrualPostingFreq>(initial?.posting2Freq  ?? "ANNUALLY");
  const [posting2Month, setPosting2Month] = useState<number | "">(initial?.posting2Month ?? "");
  const [posting2Day,   setPosting2Day]   = useState<number | "">(initial?.posting2Day   ?? "");
  const [posting2ServiceMonthBasis, setPosting2ServiceMonthBasis] = useState<ServiceMonthBasis | "">(initial?.posting2ServiceMonthBasis ?? "");
  const [posting2AnchorDate,        setPosting2AnchorDate]        = useState<string>(
    initial?.posting2AnchorDate ? new Date(initial.posting2AnchorDate).toISOString().slice(0, 10) : ""
  );
  const [posting2StartsOnYear,  setPosting2StartsOnYear]  = useState<string>(initial?.posting2StartsOnYear != null ? String(initial.posting2StartsOnYear) : "1");
  const [posting2BasedOnMonths, setPosting2BasedOnMonths] = useState<boolean>(initial?.posting2BasedOnMonths ?? false);

  // Balance reset state
  const [balanceReset, setBalanceReset] = useState<boolean>(initial?.balanceReset ?? false);
  const [resetMonth,   setResetMonth]   = useState<number | "">(initial?.resetMonth ?? "");
  const [resetDay,     setResetDay]     = useState<number | "">(initial?.resetDay   ?? "");

  // Borrowing state
  const [allowNegativeBalance,       setAllowNegativeBalance]       = useState<boolean>(initial?.allowNegativeBalance ?? false);
  const [maxNegativeHours,           setMaxNegativeHours]           = useState<string>(initial?.maxNegativeHours != null ? String(initial.maxNegativeHours) : "");
  const [carryOverEnabled,           setCarryOverEnabled]           = useState<boolean>(initial?.carryOverEnabled ?? true);
  const [carryOverRespectMaxBalance, setCarryOverRespectMaxBalance] = useState<boolean>(initial?.carryOverRespectMaxBalance ?? false);

  // Forecast state
  const [forecastEnabled,          setForecastEnabled]          = useState<boolean>(initial?.forecastEnabled ?? false);
  const [forecastMode,             setForecastMode]             = useState<"MONTHS" | "END_OF_YEAR">(
    (initial?.forecastMode as "MONTHS" | "END_OF_YEAR" | null) ?? "END_OF_YEAR"
  );
  const [forecastMonths,           setForecastMonths]           = useState<string>(initial?.forecastMonths != null ? String(initial.forecastMonths) : "3");
  const [forecastApplyToAvailable, setForecastApplyToAvailable] = useState<boolean>(initial?.forecastApplyToAvailable ?? false);

  // ── Tier helpers
  function addTier() {
    setTiers((prev) => {
      const last = prev[prev.length - 1];
      if (rateMode === "PER_POSTING") {
        return [...prev, defaultTier((last?.minTenureMonths ?? 0) + 12)];
      }
      const closedMax = last?.maxTenureMonths != null ? last.maxTenureMonths : (last?.minTenureMonths ?? 0) + 12;
      const updated = last?.maxTenureMonths == null && last != null
        ? [...prev.slice(0, -1), { ...last, maxTenureMonths: closedMax }]
        : prev;
      return [...updated, defaultTier(closedMax)];
    });
  }

  function removeTier(ti: number) {
    setTiers((prev) => prev.filter((_, i) => i !== ti));
  }

  function updateTier(ti: number, field: keyof Tier, value: number | null) {
    setTiers((prev) => prev.map((t, i) => i === ti ? { ...t, [field]: value } : t));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const posting: PostingConfig = {
      rateMode,
      serviceMonthBasis,
      postingAnchorDate: postingAnchorDate || null,
      posting1Freq,
      posting1Month: posting1Month !== "" ? posting1Month : null,
      posting1Day:   posting1Day   !== "" ? posting1Day   : null,
      dualPosting,
      posting2Freq:             dualPosting ? posting2Freq : null,
      posting2Month:            dualPosting && posting2Month !== "" ? posting2Month : null,
      posting2Day:              dualPosting && posting2Day   !== "" ? posting2Day   : null,
      posting2ServiceMonthBasis: dualPosting && posting2ServiceMonthBasis ? posting2ServiceMonthBasis : null,
      posting2AnchorDate:       dualPosting && posting2AnchorDate ? posting2AnchorDate : null,
      posting2StartsOnYear:     dualPosting && posting2StartsOnYear !== "" ? parseInt(posting2StartsOnYear, 10) : null,
      posting2BasedOnMonths:    dualPosting ? posting2BasedOnMonths : false,
      balanceReset,
      resetMonth: balanceReset && resetMonth !== "" ? resetMonth : null,
      resetDay:   balanceReset && resetDay   !== "" ? resetDay   : null,
    };
    const rules: Rule[] = rateMode === "PER_POSTING"
      ? tiers.map((t, i) => ({
          leaveTypeId,
          carryOverToLeaveTypeId,
          payCodeId,
          ...t,
          earnedHoursPerYear: 0,
          maxTenureMonths: i < tiers.length - 1 ? tiers[i + 1].minTenureMonths : null,
        }))
      : tiers.map((t) => ({ leaveTypeId, carryOverToLeaveTypeId, payCodeId, ...t }));
    onSubmit(e, rules, posting);
  }

  const [activeTab, setActiveTab] = useState<"properties" | "posting" | "computation">("properties");

  const TABS = [
    { key: "properties" as const, label: "Properties" },
    { key: "posting" as const, label: "Posting Frequency" },
    { key: "computation" as const, label: "Computation" },
  ];

  return (
    <form onSubmit={handleSubmit}>
      {/* Tab bar. The design system has no underline tab: a set this small
          and this mutually exclusive is a segmented control. */}
      <div className="mb-5">
        <SegmentedControl
          items={TABS.map((tab) => ({ value: tab.key, label: tab.label }))}
          value={activeTab}
          onChange={(v) => setActiveTab(v as typeof activeTab)}
        />
      </div>

      {/* ── Properties tab ── */}
      <div className={activeTab !== "properties" ? "hidden" : "flex flex-col gap-4"}>
        <div className={FIELD_GRID}>
          <Input label="Policy Name" name="name" required defaultValue={initial?.name ?? ""} placeholder="e.g. Full-Time PTO" />
          <Input label="Description" name="description" defaultValue={initial?.description ?? ""} placeholder="Brief description" hint="Optional" />
          <SelectField label="Leave Type" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
            {leaveTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>{lt.name}</option>
            ))}
          </SelectField>
          <SelectField label="Pay Code" value={payCodeId ?? ""} onChange={(e) => setPayCodeId(e.target.value || null)} hint="Optional">
            <option value="">— none —</option>
            {payCodes.map((pc) => (
              <option key={pc.id} value={pc.id}>
                {pc.code} – {pc.label}{pc.expressCode ? ` (${pc.expressCode})` : ""}
              </option>
            ))}
          </SelectField>
          <SelectField label="Default Policy" name="isDefault" defaultValue={initial?.isDefault ? "true" : "false"}>
            <option value="false">No</option>
            <option value="true">Yes — tenant fallback</option>
          </SelectField>
          {initial && (
            <SelectField label="Status" name="isActive" defaultValue={initial.isActive ? "true" : "false"}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </SelectField>
          )}
          <Input
            label="Max hours per day"
            name="maxDailyHours"
            type="number" min="0.25" max="24" step="0.25"
            defaultValue={initial?.maxDailyHours ?? ""}
            placeholder="No limit"
            hint="Optional. Blank means no limit; a request for more than this on one day is refused."
          />
        </div>
        <input type="hidden" name="leaveTypeId" value={leaveTypeId} />
      </div>

      {/* ── Posting Frequency tab ── */}
      <div className={activeTab !== "posting" ? "hidden" : "flex flex-col gap-4"}>
        <SelectField
          label="Service Month Based On"
          value={serviceMonthBasis}
          onChange={(e) => setServiceMonthBasis(e.target.value as ServiceMonthBasis)}
          hint="Determines which employee date is used to calculate tenure tiers and annual anniversary triggers."
        >
          {(Object.keys(SERVICE_MONTH_BASIS_LABELS) as ServiceMonthBasis[]).map((key) => (
            <option key={key} value={key}>{SERVICE_MONTH_BASIS_LABELS[key]}</option>
          ))}
        </SelectField>

        <PostingRow
          label="1st Posting"
          freq={posting1Freq}
          month={posting1Month}
          day={posting1Day}
          onFreqChange={setPosting1Freq}
          onMonthChange={setPosting1Month}
          onDayChange={setPosting1Day}
        />

        <div className="w-56">
          <Input
            label="Posting Anchor Date"
            type="date"
            value={postingAnchorDate}
            onChange={(e) => setPostingAnchorDate(e.target.value)}
            hint="Optional. A fixed reference for bi-weekly or weekly cycles; blank uses a calendar approximation."
          />
        </div>

        <Checkbox checked={dualPosting} onChange={setDualPosting} label="Enable 2nd posting" />

        {dualPosting && (
          <div
            className="flex flex-col gap-3 rounded-lg p-3"
            style={{ border: "1px dashed var(--stroke-default)" }}
          >
            <div className="flex flex-col gap-1.5">
              <span className="wms-label">Starts on the</span>
              <div className="flex flex-wrap items-center gap-2">
                <InlineInput
                  type="number" min="1" max="99" step="1"
                  aria-label="Starts on the Nth year or month"
                  value={posting2StartsOnYear}
                  onChange={(e) => setPosting2StartsOnYear(e.target.value)}
                  width={64}
                />
                <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                  {posting2BasedOnMonths ? "month(s)" : (() => {
                    const n = parseInt(posting2StartsOnYear, 10);
                    return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"} calendar year`;
                  })()}
                </span>
                <Checkbox checked={posting2BasedOnMonths} onChange={setPosting2BasedOnMonths} label="Based on Months" />
              </div>
            </div>

            <SelectField
              label="Service Month Based On"
              value={posting2ServiceMonthBasis}
              onChange={(e) => setPosting2ServiceMonthBasis(e.target.value as ServiceMonthBasis | "")}
            >
              <option value="">— same as 1st posting —</option>
              {(Object.keys(SERVICE_MONTH_BASIS_LABELS) as ServiceMonthBasis[]).map((key) => (
                <option key={key} value={key}>{SERVICE_MONTH_BASIS_LABELS[key]}</option>
              ))}
            </SelectField>

            <PostingRow
              label="2nd Posting"
              freq={posting2Freq}
              month={posting2Month}
              day={posting2Day}
              onFreqChange={setPosting2Freq}
              onMonthChange={setPosting2Month}
              onDayChange={setPosting2Day}
            />

            <div className="w-56">
              <Input
                label="Reference Date"
                type="date"
                value={posting2AnchorDate}
                onChange={(e) => setPosting2AnchorDate(e.target.value)}
                hint="Optional"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Computation tab ── */}
      <div className={activeTab !== "computation" ? "hidden" : "flex flex-col gap-4"}>

        <FormSection
          label="Accrual Rate Mode"
          hint={
            rateMode === "YEARLY"
              ? "Enter total hours per year — the engine divides by pay periods automatically."
              : "Enter exact hours credited each time accruals post. All leave types in this policy use the same mode."
          }
        >
          <span className="self-start">
            <SegmentedControl
              items={[
                { value: "YEARLY", label: "Annual Total" },
                { value: "PER_POSTING", label: "Per Posting Rate" },
              ]}
              value={rateMode}
              onChange={(v) => setRateMode(v as AccrualRateMode)}
              size="sm"
              ariaLabel="Accrual rate mode"
            />
          </span>
        </FormSection>

        <Panel
          label="Balance Reset"
          hint="When enabled, accrued balances are zeroed on the specified date each year. If an accrual also falls on that date, the reset applies first."
        >
          <Checkbox checked={balanceReset} onChange={setBalanceReset} label="Reset balance to 0 on a fixed date each year" />
          {balanceReset && (
            <div className="grid gap-3 pl-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(140px,48%)),1fr))]">
              <SmallField label="Reset Month">
                <InlineSelect
                  value={resetMonth}
                  onChange={(e) => setResetMonth(e.target.value !== "" ? parseInt(e.target.value, 10) : "")}
                  style={{ width: "100%" }}
                >
                  <option value="">-- select --</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </InlineSelect>
              </SmallField>
              <SmallField label="Reset Day">
                <InlineInput
                  type="number" min="1" max="31" step="1"
                  value={resetDay}
                  onChange={(e) => setResetDay(e.target.value !== "" ? parseInt(e.target.value, 10) : "")}
                  placeholder="1–31"
                  width="100%"
                />
              </SmallField>
            </div>
          )}
          {balanceReset && (
            <div className="flex flex-col gap-3 pl-1">
              <Checkbox checked={carryOverEnabled} onChange={setCarryOverEnabled} label="Carry unused time forward" />
              {carryOverEnabled && (
                <div className="flex flex-col gap-2 pl-1">
                  <span className="wms-overline">Carry-over destination</span>
                  <div className="flex items-center gap-2">
                    <span style={{ color: "var(--text-tertiary)" }}>→</span>
                    <InlineSelect
                      aria-label="Carry-over destination leave type"
                      value={carryOverToLeaveTypeId ?? ""}
                      onChange={(e) => setCarryOverToLeaveTypeId(e.target.value || null)}
                    >
                      <option value="">Same leave type</option>
                      {leaveTypes.filter((l) => l.id !== leaveTypeId).map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </InlineSelect>
                  </div>
                  {carryOverToLeaveTypeId && (
                    <Checkbox
                      checked={carryOverRespectMaxBalance}
                      onChange={setCarryOverRespectMaxBalance}
                      label="Cap carry-over at destination’s maximum balance"
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel
          label="Forecasted Hours"
          hint="Projects how many hours an employee will earn from today through the selected horizon, respecting their annual cap and current tier."
        >
          <Checkbox checked={forecastEnabled} onChange={setForecastEnabled} label="Compute forecasted hours" />
          {forecastEnabled && (
            <div className="flex flex-col gap-3 pl-1">
              <div className="flex flex-col gap-2">
                <span className="wms-overline">Forecast Horizon</span>
                <label
                  className="flex cursor-pointer items-center gap-2"
                  style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
                >
                  <input
                    type="radio"
                    name="forecastModeRadio"
                    checked={forecastMode === "END_OF_YEAR"}
                    onChange={() => setForecastMode("END_OF_YEAR")}
                    className="accent-[var(--fill-accent)]"
                  />
                  End of calendar year
                </label>
                <div
                  className="flex flex-wrap items-center gap-2"
                  style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
                >
                  <input
                    type="radio"
                    name="forecastModeRadio"
                    aria-label="Forecast a fixed number of months"
                    checked={forecastMode === "MONTHS"}
                    onChange={() => setForecastMode("MONTHS")}
                    className="accent-[var(--fill-accent)]"
                  />
                  <span>Up to</span>
                  {/* Typing in the box picks the mode as well — reaching for the
                      number and getting no forecast is the likelier mistake. */}
                  <InlineInput
                    type="number" min="1" max="120" step="1"
                    aria-label="Forecast months"
                    value={forecastMonths}
                    onChange={(e) => { setForecastMode("MONTHS"); setForecastMonths(e.target.value); }}
                    width={64}
                  />
                  <span>months</span>
                </div>
              </div>
              <div className="pt-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
                <Checkbox
                  checked={forecastApplyToAvailable}
                  onChange={setForecastApplyToAvailable}
                  label="Apply forecasted hours to available balance"
                />
                <p
                  className="mt-1 pl-6"
                  style={{ margin: 0, font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" }}
                >
                  When checked, the employee&apos;s available balance will include projected future accruals. When unchecked, the forecast is computed and displayed but does not affect the available balance.
                </p>
              </div>
            </div>
          )}
        </Panel>

        <Panel
          label="Borrowing"
          hint="When enabled, employees can request leave even if their balance would go negative. The max borrow limit prevents the balance from falling below a set number of hours."
        >
          <Checkbox
            checked={allowNegativeBalance}
            onChange={setAllowNegativeBalance}
            label="Allow employees to borrow against future accruals"
          />
          {allowNegativeBalance && (
            <div className="w-40 pl-1">
              <SmallField label="Max Borrow Hours">
                <InlineInput
                  type="number" min="0.25" max="9999" step="0.25"
                  value={maxNegativeHours}
                  onChange={(e) => setMaxNegativeHours(e.target.value)}
                  placeholder="No limit"
                  width="100%"
                />
              </SmallField>
            </div>
          )}
        </Panel>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="wms-overline">Accrual Tiers</span>
            <Button
              type="button"
              hierarchy="link"
              size="sm"
              onClick={addTier}
              leadingIcon={<Plus className="h-3 w-3" />}
            >
              {rateMode === "PER_POSTING" ? "Add level" : "Add tier"}
            </Button>
          </div>
          <div className="rounded-xl" style={{ border: "1px solid var(--stroke-secondary)", overflow: "hidden" }}>
            {rateMode === "PER_POSTING" ? (
              <Table>
                <THead>
                  <TR>
                    <TH align="center" style={{ width: 44 }}>Lvl</TH>
                    <TH>Svc Month</TH>
                    <TH>Accrual Hrs</TH>
                    <TH>Carry-Over</TH>
                    <TH>Max Annual Use</TH>
                    <TH>Max Balance</TH>
                    <TH style={{ width: 40 }} aria-label="Remove" />
                  </TR>
                </THead>
                <TBody>
                  {tiers.map((tier, ti) => (
                    <TR key={ti}>
                      <TD align="center" style={{ font: "var(--type-body2)", fontWeight: "var(--weight-medium)", color: "var(--text-tertiary)" }}>
                        {ti + 1}
                      </TD>
                      <TD>
                        <InlineInput
                          type="number" min="0" step="1"
                          aria-label={`Level ${ti + 1} service month`}
                          value={tier.minTenureMonths}
                          onChange={(e) => updateTier(ti, "minTenureMonths", parseInt(e.target.value, 10) || 0)}
                          width={64}
                        />
                      </TD>
                      <TD>
                        <InlineInput
                          type="number" min="0" max="9999" step="0.01"
                          aria-label={`Level ${ti + 1} accrual hours`}
                          value={tier.annualHours === 0 ? "" : tier.annualHours}
                          placeholder="0.00"
                          onChange={(e) => updateTier(ti, "annualHours", e.target.value === "" ? 0 : (parseFloat(e.target.value) || 0))}
                          width={80}
                        />
                      </TD>
                      <TD>
                        <InlineInput
                          type="number" min="0" max="9999" step="1"
                          aria-label={`Level ${ti + 1} carry-over hours`}
                          value={tier.carryOverHours ?? ""}
                          placeholder="Unlimited"
                          onChange={(e) => updateTier(ti, "carryOverHours", e.target.value !== "" ? parseInt(e.target.value, 10) : null)}
                          width={96}
                        />
                      </TD>
                      <TD>
                        <InlineInput
                          type="number" min="0" max="9999" step="0.5"
                          aria-label={`Level ${ti + 1} max annual use`}
                          value={tier.maxAnnualHours ?? ""}
                          placeholder="No limit"
                          onChange={(e) => updateTier(ti, "maxAnnualHours", e.target.value !== "" ? parseFloat(e.target.value) : null)}
                          width={96}
                        />
                      </TD>
                      <TD>
                        <InlineInput
                          type="number" min="0" max="9999" step="0.5"
                          aria-label={`Level ${ti + 1} max balance`}
                          value={tier.maxBalanceHours ?? ""}
                          placeholder="No limit"
                          onChange={(e) => updateTier(ti, "maxBalanceHours", e.target.value !== "" ? parseFloat(e.target.value) : null)}
                          width={96}
                        />
                      </TD>
                      <TD align="right">
                        {tiers.length > 1 && (
                          <Button
                            type="button"
                            hierarchy="tertiary"
                            tone="error"
                            size="sm"
                            iconOnly
                            aria-label={`Remove level ${ti + 1}`}
                            onClick={() => removeTier(ti)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <div className="flex flex-col">
                {tiers.map((tier, ti) => (
                  <div
                    key={ti}
                    className="px-4 py-3"
                    style={{ borderBottom: ti < tiers.length - 1 ? "1px solid var(--stroke-divider)" : undefined }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="wms-overline">Tenure</span>
                        <InlineInput
                          type="number" min="0" step="1"
                          aria-label={`Tier ${ti + 1} minimum tenure months`}
                          value={tier.minTenureMonths}
                          onChange={(e) => updateTier(ti, "minTenureMonths", parseInt(e.target.value, 10) || 0)}
                          width={56}
                        />
                        <span style={{ color: "var(--text-tertiary)" }}>–</span>
                        <InlineInput
                          type="number" min="1" step="1"
                          aria-label={`Tier ${ti + 1} maximum tenure months`}
                          value={tier.maxTenureMonths ?? ""}
                          onChange={(e) => updateTier(ti, "maxTenureMonths", e.target.value !== "" ? parseInt(e.target.value, 10) : null)}
                          placeholder="∞"
                          width={56}
                        />
                        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>months</span>
                      </div>
                      {tiers.length > 1 && (
                        <Button
                          type="button"
                          hierarchy="tertiary"
                          tone="error"
                          size="sm"
                          iconOnly
                          aria-label={`Remove tier ${ti + 1}`}
                          onClick={() => removeTier(ti)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(120px,18%)),1fr))]">
                      <SmallField label="Annual Hours">
                        <InlineInput
                          type="number" min="0" max="9999" step="0.01"
                          value={tier.annualHours === 0 ? "" : tier.annualHours}
                          placeholder="0"
                          onChange={(e) => updateTier(ti, "annualHours", e.target.value === "" ? 0 : (parseFloat(e.target.value) || 0))}
                          width="100%"
                        />
                      </SmallField>
                      <SmallField label="+ Hrs/Yr Tenure">
                        <InlineInput
                          type="number" min="0" max="999" step="0.01"
                          value={tier.earnedHoursPerYear === 0 ? "" : tier.earnedHoursPerYear}
                          placeholder="0"
                          onChange={(e) => updateTier(ti, "earnedHoursPerYear", e.target.value === "" ? 0 : (parseFloat(e.target.value) || 0))}
                          width="100%"
                        />
                      </SmallField>
                      <SmallField label="Carry-Over Hrs">
                        <InlineInput
                          type="number" min="0" max="9999" step="1"
                          value={tier.carryOverHours ?? ""}
                          onChange={(e) => updateTier(ti, "carryOverHours", e.target.value !== "" ? parseInt(e.target.value, 10) : null)}
                          placeholder="Unlimited"
                          width="100%"
                        />
                      </SmallField>
                      <SmallField label="Max Annual Use">
                        <InlineInput
                          type="number" min="0" max="9999" step="0.5"
                          value={tier.maxAnnualHours ?? ""}
                          onChange={(e) => updateTier(ti, "maxAnnualHours", e.target.value !== "" ? parseFloat(e.target.value) : null)}
                          placeholder="No limit"
                          width="100%"
                        />
                      </SmallField>
                      <SmallField label="Max Balance">
                        <InlineInput
                          type="number" min="0" max="9999" step="0.5"
                          value={tier.maxBalanceHours ?? ""}
                          onChange={(e) => updateTier(ti, "maxBalanceHours", e.target.value !== "" ? parseFloat(e.target.value) : null)}
                          placeholder="No limit"
                          width="100%"
                        />
                      </SmallField>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Always-rendered hidden inputs (must stay in DOM for form submission) */}
      <input type="hidden" name="carryOverEnabled"           value={carryOverEnabled           ? "true" : "false"} />
      <input type="hidden" name="carryOverRespectMaxBalance" value={carryOverRespectMaxBalance ? "true" : "false"} />
      <input type="hidden" name="forecastEnabled"            value={forecastEnabled            ? "true" : "false"} />
      <input type="hidden" name="forecastMode"               value={forecastEnabled ? forecastMode : ""} />
      <input type="hidden" name="forecastMonths"             value={forecastEnabled && forecastMode === "MONTHS" ? forecastMonths : ""} />
      <input type="hidden" name="forecastApplyToAvailable"   value={forecastApplyToAvailable   ? "true" : "false"} />
      <input type="hidden" name="allowNegativeBalance"       value={allowNegativeBalance       ? "true" : "false"} />
      <input type="hidden" name="maxNegativeHours"           value={allowNegativeBalance ? maxNegativeHours : ""} />

      <div className="mt-5 flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : initial ? "Save Changes" : "Create"}
        </Button>
        <Button type="button" hierarchy="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// ─── Main manager ─────────────────────────────────────────────────────────────

export function PtoPoliciesManager({ policies, leaveTypes, payCodes, initialPolicyId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");

  function openEdit(p: Policy) { setEditingPolicy(p); setConfirmDeleteId(null); setError(null); }

  useEffect(() => {
    if (!initialPolicyId) return;
    const target = policies.find((p) => p.id === initialPolicyId);
    if (target) openEdit(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function closeEdit() { setEditingPolicy(null); setConfirmDeleteId(null); setError(null); }
  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  function handleCreate(e: React.FormEvent<HTMLFormElement>, rules: Rule[], posting: PostingConfig) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    const rawMax         = fd.get("maxDailyHours")               as string;
    const rawNegBal      = fd.get("allowNegativeBalance")        as string;
    const rawMaxNeg      = fd.get("maxNegativeHours")            as string;
    const rawCarryOn     = fd.get("carryOverEnabled")            as string;
    const rawRespectMax  = fd.get("carryOverRespectMaxBalance")  as string;
    const rawFcEnabled   = fd.get("forecastEnabled")             as string;
    const rawFcMode      = fd.get("forecastMode")                as string;
    const rawFcMonths    = fd.get("forecastMonths")              as string;
    const rawFcApply     = fd.get("forecastApplyToAvailable")    as string;
    startTransition(async () => {
      const result = await createPtoPolicy({
        name:                       fd.get("name") as string,
        description:                (fd.get("description") as string) || undefined,
        isDefault:                  fd.get("isDefault") === "true",
        leaveTypeId:                fd.get("leaveTypeId") as string,
        maxDailyHours:              rawMax       !== "" ? parseFloat(rawMax) : null,
        allowNegativeBalance:       rawNegBal    === "true",
        maxNegativeHours:           rawMaxNeg    !== "" ? parseFloat(rawMaxNeg) : null,
        carryOverEnabled:           rawCarryOn   !== "false",
        carryOverRespectMaxBalance: rawRespectMax === "true",
        forecastEnabled:            rawFcEnabled  === "true",
        forecastMode:               rawFcMode     !== "" ? rawFcMode as "MONTHS" | "END_OF_YEAR" : null,
        forecastMonths:             rawFcMonths   !== "" ? parseInt(rawFcMonths, 10) : null,
        forecastApplyToAvailable:   rawFcApply    === "true",
        rules,
        ...posting,
        postingAnchorDate:  posting.postingAnchorDate  ?? null,
        posting2AnchorDate: posting.posting2AnchorDate ?? null,
      });
      if ("success" in result && !result.success) { setError((result as { success: false; error: string }).error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(policy: Policy, e: React.FormEvent<HTMLFormElement>, rules: Rule[], posting: PostingConfig) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    const rawMax         = fd.get("maxDailyHours")               as string;
    const rawNegBal      = fd.get("allowNegativeBalance")        as string;
    const rawMaxNeg      = fd.get("maxNegativeHours")            as string;
    const rawCarryOn     = fd.get("carryOverEnabled")            as string;
    const rawRespectMax  = fd.get("carryOverRespectMaxBalance")  as string;
    const rawFcEnabled   = fd.get("forecastEnabled")             as string;
    const rawFcMode      = fd.get("forecastMode")                as string;
    const rawFcMonths    = fd.get("forecastMonths")              as string;
    const rawFcApply     = fd.get("forecastApplyToAvailable")    as string;
    startTransition(async () => {
      const result = await updatePtoPolicy({
        ptoPolicyId:                policy.id,
        name:                       fd.get("name") as string,
        description:                (fd.get("description") as string) || null,
        isDefault:                  fd.get("isDefault") === "true",
        isActive:                   fd.get("isActive") === "true",
        leaveTypeId:                fd.get("leaveTypeId") as string,
        maxDailyHours:              rawMax       !== "" ? parseFloat(rawMax) : null,
        allowNegativeBalance:       rawNegBal    === "true",
        maxNegativeHours:           rawMaxNeg    !== "" ? parseFloat(rawMaxNeg) : null,
        carryOverEnabled:           rawCarryOn   !== "false",
        carryOverRespectMaxBalance: rawRespectMax === "true",
        forecastEnabled:            rawFcEnabled  === "true",
        forecastMode:               rawFcMode     !== "" ? rawFcMode as "MONTHS" | "END_OF_YEAR" : null,
        forecastMonths:             rawFcMonths   !== "" ? parseInt(rawFcMonths, 10) : null,
        forecastApplyToAvailable:   rawFcApply    === "true",
        rules,
        ...posting,
        postingAnchorDate:  posting.postingAnchorDate  ?? null,
        posting2AnchorDate: posting.posting2AnchorDate ?? null,
      });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  function handleDelete(policyId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePtoPolicy({ ptoPolicyId: policyId });
      if (!result.success) { setError(result.error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      closeEdit();
      router.refresh();
    });
  }

  /** How the policy posts, in one line: rate mode, frequency, and any reset. */
  function postingLabel(p: Policy): string {
    const freq = (() => {
      const p1 = FREQ_LABELS[p.posting1Freq];
      if (!p.dualPosting || !p.posting2Freq) return p1;
      return `${p1} + ${FREQ_LABELS[p.posting2Freq]}`;
    })();
    const mode = p.rateMode === "PER_POSTING" ? "Per Posting Rate" : "Annual Total";
    const reset = p.balanceReset && p.resetMonth != null && p.resetDay != null
      ? ` · Resets ${MONTHS[p.resetMonth - 1]} ${p.resetDay}`
      : "";
    return `${mode} · ${freq}${reset}`;
  }

  const searchLower = search.trim().toLowerCase();
  const visible = policies
    .filter((p) => (view === "all" ? true : view === "active" ? p.isActive : !p.isActive))
    .filter((p) => !searchLower || p.name.toLowerCase().includes(searchLower))
    .sort((a, b) => {
      // Grouped by leave type, then by name — the same order the grouped list
      // had, kept as a sort so the Leave Type column reads down in runs.
      const al = a.leaveType?.name ?? "￿";
      const bl = b.leaveType?.name ?? "￿";
      return al === bl ? a.name.localeCompare(b.name) : al.localeCompare(bl);
    });

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {error && !editingPolicy && !showCreate && <Banner tone="error" body={error} />}

      <Toolbar count={visible.length} countLabel="policy">
        <SegmentedControl
          items={VIEWS}
          value={view}
          onChange={(v) => setView(v as View)}
          size="sm"
          ariaLabel="Which policies to show"
        />
        <SearchInput value={search} onValueChange={setSearch} placeholder="Search policies…" width={220} />
        <Button onClick={openCreate}>New Policy</Button>
      </Toolbar>

      <Card padding={0}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title={searchLower ? `No policies match “${search}”` : view === "active" ? "No active policies" : "No PTO policies"}
            body="A policy decides how much leave an employee earns, how often it posts and what happens to the balance at year end."
            action={
              searchLower
                ? <Button size="sm" hierarchy="secondary" onClick={() => setSearch("")}>Clear search</Button>
                : <Button size="sm" onClick={openCreate}>New Policy</Button>
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Policy</TH>
                  <TH>Leave Type</TH>
                  <TH>Posting</TH>
                  <TH numeric>Tiers</TH>
                  <TH numeric>Sites</TH>
                  <TH numeric>Overrides</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((policy) => (
                  <TR key={policy.id} onClick={() => openEdit(policy)}>
                    <TD>
                      <span className="flex items-center gap-2">
                        <span style={{ fontWeight: "var(--weight-medium)" }}>{policy.name}</span>
                        {policy.isDefault && <Badge tone="info" size="sm">Default</Badge>}
                      </span>
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>
                      {policy.leaveType?.name ?? <span style={{ color: "var(--text-tertiary)" }}>Unassigned</span>}
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>{postingLabel(policy)}</TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>{policy.rules.length}</TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>{policy._count.siteLinks}</TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>{policy._count.empOverrides}</TD>
                    <TD>
                      {policy.isActive ? (
                        <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                      ) : (
                        // statusTone would answer "warning"; a policy nobody is
                        // on is not something to go and fix.
                        <Badge size="sm">Inactive</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter
              shown={visible.length}
              total={policies.length}
              label={policies.length === 1 ? "policy" : "policies"}
            />
          </>
        )}
      </Card>

      {showCreate && (
        <Modal title="New PTO Policy" onClose={closeCreate}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <PolicyForm leaveTypes={leaveTypes} payCodes={payCodes} isPending={isPending} onSubmit={handleCreate} onCancel={closeCreate} />
        </Modal>
      )}

      {editingPolicy && (
        <Modal title={`Edit: ${editingPolicy.name}`} onClose={closeEdit}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <PolicyForm
            leaveTypes={leaveTypes}
            payCodes={payCodes}
            initial={editingPolicy}
            isPending={isPending}
            onSubmit={(e, rules, posting) => handleUpdate(editingPolicy, e, rules, posting)}
            onCancel={closeEdit}
          />
          {/* Outside the form on purpose: deleting is not a way of saving, and
              a submit button beside it is one mis-click from the same place. */}
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
            {confirmDeleteId === editingPolicy.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Are you sure?</span>
                <Button type="button" tone="error" size="sm" onClick={() => handleDelete(editingPolicy.id)} disabled={isPending}>
                  {isPending ? "Deleting…" : "Yes, delete"}
                </Button>
                <Button type="button" hierarchy="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
              </div>
            ) : (
              <Button
                type="button"
                hierarchy="link"
                tone="error"
                size="sm"
                onClick={() => setConfirmDeleteId(editingPolicy.id)}
                leadingIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Delete policy
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
