"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Trash2 } from "lucide-react";
import { createPtoPolicy, updatePtoPolicy, deletePtoPolicy } from "@/actions/pto-policy.actions";

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

// ─── Styles ──────────────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const smInputCls = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const labelCls = "mb-1 block text-xs text-zinc-500";
const smLabelCls = "mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-400";
const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls = "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
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
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <div>
        <label className={labelCls}>Posting Frequency</label>
        <select
          value={freq}
          onChange={(e) => onFreqChange(e.target.value as AccrualPostingFreq)}
          className={inputCls}
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
        </select>
      </div>
      {freq === "ANNUALLY_FIXED" && (
        <div className="grid grid-cols-2 gap-3 pl-1">
          <div>
            <label className={smLabelCls}>Month</label>
            <select
              value={month}
              onChange={(e) => onMonthChange(e.target.value !== "" ? parseInt(e.target.value, 10) : "")}
              className={smInputCls}
            >
              <option value="">-- select --</option>
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={smLabelCls}>Day</label>
            <input
              type="number" min="1" max="31" step="1"
              value={day}
              onChange={(e) => onDayChange(e.target.value !== "" ? parseInt(e.target.value, 10) : "")}
              placeholder="1–31"
              className={smInputCls}
            />
          </div>
        </div>
      )}
    </div>
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
      {/* Tab nav */}
      <div className="mb-5 flex gap-0 border-b border-zinc-200 dark:border-zinc-700">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? "border-zinc-900 text-zinc-900 dark:border-white dark:text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Properties tab ── */}
      <div className={activeTab !== "properties" ? "hidden" : "space-y-4"}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Policy Name</label>
            <input name="name" required defaultValue={initial?.name ?? ""} placeholder="e.g. Full-Time PTO" className={inputCls} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Description <span className="text-zinc-400">(optional)</span></label>
            <input name="description" defaultValue={initial?.description ?? ""} placeholder="Brief description" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Leave Type</label>
            <select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className={inputCls}>
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>{lt.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Pay Code <span className="text-zinc-400">(optional)</span></label>
            <select value={payCodeId ?? ""} onChange={(e) => setPayCodeId(e.target.value || null)} className={inputCls}>
              <option value="">— none —</option>
              {payCodes.map((pc) => (
                <option key={pc.id} value={pc.id}>
                  {pc.code} – {pc.label}{pc.expressCode ? ` (${pc.expressCode})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Default Policy</label>
            <select name="isDefault" defaultValue={initial?.isDefault ? "true" : "false"} className={inputCls}>
              <option value="false">No</option>
              <option value="true">Yes — tenant fallback</option>
            </select>
          </div>
          {initial && (
            <div>
              <label className={labelCls}>Status</label>
              <select name="isActive" defaultValue={initial.isActive ? "true" : "false"} className={inputCls}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          )}
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Max hours per day <span className="text-zinc-400">(optional)</span></label>
            <input
              name="maxDailyHours"
              type="number" min="0.25" max="24" step="0.25"
              defaultValue={initial?.maxDailyHours ?? ""}
              placeholder="No limit"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-zinc-400">Leave blank for no limit. Employees requesting more than this on a single day will see an error.</p>
          </div>
        </div>
        <input type="hidden" name="leaveTypeId" value={leaveTypeId} />
      </div>

      {/* ── Posting Frequency tab ── */}
      <div className={activeTab !== "posting" ? "hidden" : "space-y-4"}>
        <div>
          <label className={labelCls}>Service Month Based On</label>
          <select
            value={serviceMonthBasis}
            onChange={(e) => setServiceMonthBasis(e.target.value as ServiceMonthBasis)}
            className={inputCls}
          >
            {(Object.keys(SERVICE_MONTH_BASIS_LABELS) as ServiceMonthBasis[]).map((key) => (
              <option key={key} value={key}>{SERVICE_MONTH_BASIS_LABELS[key]}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-400">
            Determines which employee date is used to calculate tenure tiers and annual anniversary triggers.
          </p>
        </div>

        <PostingRow
          label="1st Posting"
          freq={posting1Freq}
          month={posting1Month}
          day={posting1Day}
          onFreqChange={setPosting1Freq}
          onMonthChange={setPosting1Month}
          onDayChange={setPosting1Day}
        />

        <div>
          <label className={labelCls}>Posting Anchor Date <span className="text-zinc-400">(optional)</span></label>
          <input
            type="date"
            value={postingAnchorDate}
            onChange={(e) => setPostingAnchorDate(e.target.value)}
            className={`w-48 ${inputCls}`}
          />
          <p className="mt-1 text-xs text-zinc-400">
            Fixed reference date for bi-weekly or weekly cycles. Leave blank to use a calendar approximation.
          </p>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={dualPosting}
            onChange={(e) => setDualPosting(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 accent-zinc-800 dark:border-zinc-600"
          />
          Enable 2nd posting
        </label>

        {dualPosting && (
          <div className="space-y-3 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-600">
            {/* Starts on */}
            <div>
              <label className={labelCls}>Starts on the</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="1" max="99" step="1"
                  value={posting2StartsOnYear}
                  onChange={(e) => setPosting2StartsOnYear(e.target.value)}
                  className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                />
                <span className="text-sm text-zinc-500">
                  {posting2BasedOnMonths ? "month(s)" : (() => {
                    const n = parseInt(posting2StartsOnYear, 10);
                    return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"} calendar year`;
                  })()}
                </span>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={posting2BasedOnMonths}
                    onChange={(e) => setPosting2BasedOnMonths(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 accent-zinc-800 dark:border-zinc-600"
                  />
                  Based on Months
                </label>
              </div>
            </div>

            {/* Service Month Based On */}
            <div>
              <label className={labelCls}>Service Month Based On</label>
              <select
                value={posting2ServiceMonthBasis}
                onChange={(e) => setPosting2ServiceMonthBasis(e.target.value as ServiceMonthBasis | "")}
                className={inputCls}
              >
                <option value="">— same as 1st posting —</option>
                {(Object.keys(SERVICE_MONTH_BASIS_LABELS) as ServiceMonthBasis[]).map((key) => (
                  <option key={key} value={key}>{SERVICE_MONTH_BASIS_LABELS[key]}</option>
                ))}
              </select>
            </div>

            <PostingRow
              label="2nd Posting"
              freq={posting2Freq}
              month={posting2Month}
              day={posting2Day}
              onFreqChange={setPosting2Freq}
              onMonthChange={setPosting2Month}
              onDayChange={setPosting2Day}
            />

            {/* Reference Date */}
            <div>
              <label className={labelCls}>Reference Date <span className="text-zinc-400">(optional)</span></label>
              <input
                type="date"
                value={posting2AnchorDate}
                onChange={(e) => setPosting2AnchorDate(e.target.value)}
                className={`w-48 ${inputCls}`}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Computation tab ── */}
      <div className={activeTab !== "computation" ? "hidden" : "space-y-4"}>
        {/* Accrual Rate Mode */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Accrual Rate Mode</p>
          <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-600">
            {(["YEARLY", "PER_POSTING"] as AccrualRateMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRateMode(mode)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  rateMode === mode
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {mode === "YEARLY" ? "Annual Total" : "Per Posting Rate"}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {rateMode === "YEARLY"
              ? "Enter total hours per year — the engine divides by pay periods automatically."
              : "Enter exact hours credited each time accruals post. All leave types in this policy use the same mode."}
          </p>
        </div>

        {/* Balance Reset */}
        <div className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Balance Reset</p>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={balanceReset}
              onChange={(e) => setBalanceReset(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 accent-zinc-800 dark:border-zinc-600"
            />
            Reset balance to 0 on a fixed date each year
          </label>
          {balanceReset && (
            <div className="mt-3 grid grid-cols-2 gap-3 pl-1">
              <div>
                <label className={smLabelCls}>Reset Month</label>
                <select
                  value={resetMonth}
                  onChange={(e) => setResetMonth(e.target.value !== "" ? parseInt(e.target.value, 10) : "")}
                  className={smInputCls}
                >
                  <option value="">-- select --</option>
                  {MONTHS.map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={smLabelCls}>Reset Day</label>
                <input
                  type="number" min="1" max="31" step="1"
                  value={resetDay}
                  onChange={(e) => setResetDay(e.target.value !== "" ? parseInt(e.target.value, 10) : "")}
                  placeholder="1–31"
                  className={smInputCls}
                />
              </div>
            </div>
          )}
          {balanceReset && (
            <div className="mt-3 space-y-3 pl-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={carryOverEnabled}
                  onChange={(e) => setCarryOverEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 accent-zinc-800 dark:border-zinc-600"
                />
                Carry unused time forward
              </label>
              {carryOverEnabled && (
                <div className="space-y-2 pl-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Carry-over destination</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">→</span>
                    <select
                      value={carryOverToLeaveTypeId ?? ""}
                      onChange={(e) => setCarryOverToLeaveTypeId(e.target.value || null)}
                      className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    >
                      <option value="">Same leave type</option>
                      {leaveTypes.filter((l) => l.id !== leaveTypeId).map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                  {carryOverToLeaveTypeId && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <input
                        type="checkbox"
                        checked={carryOverRespectMaxBalance}
                        onChange={(e) => setCarryOverRespectMaxBalance(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-800 dark:border-zinc-600"
                      />
                      Cap carry-over at destination&apos;s maximum balance
                    </label>
                  )}
                </div>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-400">
            When enabled, accrued balances are zeroed on the specified date each year. If an accrual also falls on that date, the reset applies first.
          </p>
        </div>

        {/* Forecasted Hours */}
        <div className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Forecasted Hours</p>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={forecastEnabled}
              onChange={(e) => setForecastEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 accent-zinc-800 dark:border-zinc-600"
            />
            Compute forecasted hours
          </label>
          {forecastEnabled && (
            <div className="mt-3 space-y-3 pl-1">
              <div className="space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Forecast Horizon</p>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <input
                    type="radio"
                    name="forecastModeRadio"
                    checked={forecastMode === "END_OF_YEAR"}
                    onChange={() => setForecastMode("END_OF_YEAR")}
                    className="h-4 w-4 accent-zinc-800"
                  />
                  End of calendar year
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="forecastModeRadio"
                    checked={forecastMode === "MONTHS"}
                    onChange={() => setForecastMode("MONTHS")}
                    className="h-4 w-4 accent-zinc-800"
                  />
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">Up to</span>
                  <input
                    type="number" min="1" max="120" step="1"
                    value={forecastMonths}
                    onChange={(e) => { setForecastMode("MONTHS"); setForecastMonths(e.target.value); }}
                    className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">months</span>
                </div>
              </div>
              <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={forecastApplyToAvailable}
                    onChange={(e) => setForecastApplyToAvailable(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 accent-zinc-800 dark:border-zinc-600"
                  />
                  Apply forecasted hours to available balance
                </label>
                <p className="mt-1 pl-6 text-xs text-zinc-400">
                  When checked, the employee&apos;s available balance will include projected future accruals. When unchecked, the forecast is computed and displayed but does not affect the available balance.
                </p>
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-400">
            Projects how many hours an employee will earn from today through the selected horizon, respecting their annual cap and current tier.
          </p>
        </div>

        {/* Borrowing */}
        <div className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Borrowing</p>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={allowNegativeBalance}
              onChange={(e) => setAllowNegativeBalance(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 accent-zinc-800 dark:border-zinc-600"
            />
            Allow employees to borrow against future accruals
          </label>
          {allowNegativeBalance && (
            <div className="mt-3 pl-1">
              <label className={smLabelCls}>Max Borrow Hours <span className="text-zinc-400 normal-case">(optional)</span></label>
              <input
                type="number" min="0.25" max="9999" step="0.25"
                value={maxNegativeHours}
                onChange={(e) => setMaxNegativeHours(e.target.value)}
                placeholder="No limit"
                className="w-36 rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-400">
            When enabled, employees can request leave even if their balance would go negative. The max borrow limit prevents the balance from falling below a set number of hours.
          </p>
        </div>

        {/* Accrual Tiers */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Accrual Tiers</p>
            <button type="button" onClick={addTier} className="flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400">
              <Plus className="h-3 w-3" /> {rateMode === "PER_POSTING" ? "Add level" : "Add tier"}
            </button>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700">
            {rateMode === "PER_POSTING" ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                      <th className="w-10 px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Lvl</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Svc Month</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Accrual Hrs</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Carry-Over</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Max Annual Use</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Max Balance</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {tiers.map((tier, ti) => (
                      <tr key={ti}>
                        <td className="px-3 py-2 text-center text-xs font-medium text-zinc-400">{ti + 1}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="1"
                            value={tier.minTenureMonths}
                            onChange={(e) => updateTier(ti, "minTenureMonths", parseInt(e.target.value, 10) || 0)}
                            className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" max="9999" step="0.01"
                            value={tier.annualHours === 0 ? "" : tier.annualHours}
                            placeholder="0.00"
                            onChange={(e) => updateTier(ti, "annualHours", e.target.value === "" ? 0 : (parseFloat(e.target.value) || 0))}
                            className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" max="9999" step="1"
                            value={tier.carryOverHours ?? ""}
                            placeholder="Unlimited"
                            onChange={(e) => updateTier(ti, "carryOverHours", e.target.value !== "" ? parseInt(e.target.value, 10) : null)}
                            className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" max="9999" step="0.5"
                            value={tier.maxAnnualHours ?? ""}
                            placeholder="No limit"
                            onChange={(e) => updateTier(ti, "maxAnnualHours", e.target.value !== "" ? parseFloat(e.target.value) : null)}
                            className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" max="9999" step="0.5"
                            value={tier.maxBalanceHours ?? ""}
                            placeholder="No limit"
                            onChange={(e) => updateTier(ti, "maxBalanceHours", e.target.value !== "" ? parseFloat(e.target.value) : null)}
                            className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {tiers.length > 1 && (
                            <button type="button" onClick={() => removeTier(ti)} className="text-zinc-300 hover:text-red-500 dark:text-zinc-600">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {tiers.map((tier, ti) => (
                  <div key={ti} className="px-4 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Tenure</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min="0" step="1" value={tier.minTenureMonths}
                            onChange={(e) => updateTier(ti, "minTenureMonths", parseInt(e.target.value, 10) || 0)}
                            className="w-14 rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                          />
                          <span className="text-xs text-zinc-400">–</span>
                          <input
                            type="number" min="1" step="1" value={tier.maxTenureMonths ?? ""}
                            onChange={(e) => updateTier(ti, "maxTenureMonths", e.target.value !== "" ? parseInt(e.target.value, 10) : null)}
                            placeholder="∞"
                            className="w-14 rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                          />
                          <span className="text-xs text-zinc-400">months</span>
                        </div>
                      </div>
                      {tiers.length > 1 && (
                        <button type="button" onClick={() => removeTier(ti)} className="text-zinc-300 hover:text-red-500 dark:text-zinc-600">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-5 gap-3">
                      <div>
                        <label className={smLabelCls}>Annual Hours</label>
                        <input type="number" min="0" max="9999" step="0.01"
                          value={tier.annualHours === 0 ? "" : tier.annualHours}
                          placeholder="0"
                          onChange={(e) => updateTier(ti, "annualHours", e.target.value === "" ? 0 : (parseFloat(e.target.value) || 0))}
                          className={smInputCls}
                        />
                      </div>
                      <div>
                        <label className={smLabelCls}>+ Hrs/Yr Tenure</label>
                        <input type="number" min="0" max="999" step="0.01"
                          value={tier.earnedHoursPerYear === 0 ? "" : tier.earnedHoursPerYear}
                          placeholder="0"
                          onChange={(e) => updateTier(ti, "earnedHoursPerYear", e.target.value === "" ? 0 : (parseFloat(e.target.value) || 0))}
                          className={smInputCls}
                        />
                      </div>
                      <div>
                        <label className={smLabelCls}>Carry-Over Hrs</label>
                        <input type="number" min="0" max="9999" step="1"
                          value={tier.carryOverHours ?? ""}
                          onChange={(e) => updateTier(ti, "carryOverHours", e.target.value !== "" ? parseInt(e.target.value, 10) : null)}
                          placeholder="Unlimited"
                          className={smInputCls}
                        />
                      </div>
                      <div>
                        <label className={smLabelCls}>Max Annual Use</label>
                        <input type="number" min="0" max="9999" step="0.5"
                          value={tier.maxAnnualHours ?? ""}
                          onChange={(e) => updateTier(ti, "maxAnnualHours", e.target.value !== "" ? parseFloat(e.target.value) : null)}
                          placeholder="No limit"
                          className={smInputCls}
                        />
                      </div>
                      <div>
                        <label className={smLabelCls}>Max Balance</label>
                        <input type="number" min="0" max="9999" step="0.5"
                          value={tier.maxBalanceHours ?? ""}
                          onChange={(e) => updateTier(ti, "maxBalanceHours", e.target.value !== "" ? parseFloat(e.target.value) : null)}
                          placeholder="No limit"
                          className={smInputCls}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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

      <div className="mt-5 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <button type="submit" disabled={isPending} className={saveBtnCls}>
          {isPending ? "Saving…" : initial ? "Save Changes" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className={cancelBtnCls}>Cancel</button>
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

  const [search, setSearch] = useState("");
  const searchLower = search.trim().toLowerCase();

  const policyGroups: { label: string; policies: Policy[] }[] = (() => {
    const map = new Map<string, Policy[]>();
    for (const p of policies) {
      if (searchLower && !p.name.toLowerCase().includes(searchLower)) continue;
      const key = p.leaveType?.name ?? "Unassigned";
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        if (a === "Unassigned") return 1;
        if (b === "Unassigned") return -1;
        return a.localeCompare(b);
      })
      .map(([label, ps]) => ({ label, policies: ps.sort((a, b) => a.name.localeCompare(b.name)) }));
  })();

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const allExpanded = policyGroups.length > 0 && expandedGroups.size === policyGroups.length;

  function toggleGroup(label: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  function toggleAll() {
    setExpandedGroups(allExpanded ? new Set() : new Set(policyGroups.map((g) => g.label)));
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-3">
        {policies.length > 0 && (
          <>
            <div className="relative flex-1 max-w-xs">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search policies…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-700 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500"
              />
            </div>
            {policyGroups.length > 0 && !searchLower && (
              <button
                type="button"
                onClick={toggleAll}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
              >
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
            )}
          </>
        )}
        <button
          onClick={openCreate}
          className="ml-auto rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Add Policy
        </button>
      </div>
      {searchLower && policyGroups.length === 0 && (
        <p className="text-sm text-zinc-400">No policies match &ldquo;{search}&rdquo;.</p>
      )}
      <div className="flex flex-col gap-3">
        {policyGroups.map(({ label, policies: groupPolicies }) => {
          const isOpen = searchLower ? true : expandedGroups.has(label);
          return (
            <div key={label}>
              <button
                type="button"
                onClick={() => toggleGroup(label)}
                className="flex w-full items-center gap-1.5 text-left"
              >
                <svg
                  className={`h-3 w-3 flex-shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
                <span className="text-xs text-zinc-300 dark:text-zinc-600">({groupPolicies.length})</span>
              </button>
              {isOpen && (
                <div className="mt-1.5 flex flex-col gap-2">
                  {groupPolicies.map((policy) => {
                    const tierCount = policy.rules.length;
                    return (
                      <button
                        key={policy.id}
                        type="button"
                        onClick={() => openEdit(policy)}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`font-medium ${policy.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                              {policy.name}
                            </span>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                              policy.isActive
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                            }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${policy.isActive ? "bg-green-500 dark:bg-green-400" : "bg-zinc-400 dark:bg-zinc-500"}`} />
                              {policy.isActive ? "Active" : "Inactive"}
                            </span>
                            {policy.isDefault && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Default</span>
                            )}
                          </div>
                          <span className="text-xs text-zinc-400">Click to edit →</span>
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-400">
                          {postingLabel(policy)}
                          {tierCount > 1 && <> · {tierCount} tiers</>}
                          {policy._count.siteLinks + policy._count.empOverrides > 0 && (
                            <> · {policy._count.siteLinks} site{policy._count.siteLinks !== 1 ? "s" : ""} · {policy._count.empOverrides} override{policy._count.empOverrides !== 1 ? "s" : ""}</>
                          )}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showCreate && (
        <Modal title="New PTO Policy" onClose={closeCreate}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          <PolicyForm leaveTypes={leaveTypes} payCodes={payCodes} isPending={isPending} onSubmit={handleCreate} onCancel={closeCreate} />
        </Modal>
      )}

      {editingPolicy && (
        <Modal title={`Edit: ${editingPolicy.name}`} onClose={closeEdit}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          <PolicyForm
            leaveTypes={leaveTypes}
            payCodes={payCodes}
            initial={editingPolicy}
            isPending={isPending}
            onSubmit={(e, rules, posting) => handleUpdate(editingPolicy, e, rules, posting)}
            onCancel={closeEdit}
          />
          <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-700">
            {confirmDeleteId === editingPolicy.id ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Are you sure?</span>
                <button type="button" onClick={() => handleDelete(editingPolicy.id)} disabled={isPending} className={dangerBtnCls}>
                  {isPending ? "Deleting…" : "Yes, delete"}
                </button>
                <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDeleteId(editingPolicy.id)} className="flex items-center gap-1.5 text-xs text-red-500 hover:underline dark:text-red-400">
                <Trash2 className="h-3.5 w-3.5" /> Delete policy
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
