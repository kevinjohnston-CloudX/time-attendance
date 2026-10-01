"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import {
  previewPayrollRun,
  processPayrollRun,
  type PeriodGroup,
  type RunPayrollInput,
  type RunPreview,
} from "@/actions/payroll-run.actions";
import type { EpiSummary } from "@/lib/payroll/adp-epi";
import { saveRunCodes, type RunCodes } from "@/lib/payroll/run-codes";
import { MultiSelectFilter } from "@/classic/components/payroll/multi-select-filter";

type Option = { id: string; name: string };

interface Props {
  periodGroups: PeriodGroup[];
  ruleSets: Option[];
  payCategories: Option[];
  sites: Option[];
  departments: Option[];
  agencies: Option[];
  savedCodes: RunCodes;
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const labelCls = "mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400";
const panelCls = "rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900";

const hrs = (minutes: number) => (minutes / 60).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "warning" | "info" | "success"; children: ReactNode }) {
  const cls = {
    error: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    warning: "bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300",
    info: "bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300",
    success: "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300",
  }[tone];
  return <div className={`rounded-lg px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

function download(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function RunPayrollScreen({ periodGroups, ruleSets, payCategories, sites, departments, agencies, savedCodes }: Props) {
  const [isPending, startTransition] = useTransition();
  const [periodKey, setPeriodKey] = useState(periodGroups[0]?.key ?? "");
  const [codes, setCodes] = useState<RunCodes>(savedCodes);
  const [filters, setFilters] = useState({ badgeIds: "", ruleSetIds: [] as string[], payCategoryIds: [] as string[], siteIds: [] as string[], departmentIds: [] as string[], agencyIds: [] as string[] });
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [result, setResult] = useState<{ csv: string; filename: string; summary: EpiSummary; locked: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const group = periodGroups.find((g) => g.key === periodKey) ?? null;
  const input: RunPayrollInput = useMemo(() => ({ periodKey, filters, codes }), [periodKey, filters, codes]);

  const setCode = (k: keyof RunCodes, v: string) => { setCodes((c) => ({ ...c, [k]: v.toUpperCase() })); setPreview(null); };
  const setFilter = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) => { setFilters((f) => ({ ...f, [k]: v })); setPreview(null); };

  function runPreview() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await previewPayrollRun(input);
      if (!r.success) return setError(r.error);
      setPreview(r.data);
    });
  }

  function runProcess() {
    if (!preview) return;
    const lockCount = preview.toLock.length;
    const outside = preview.toLock.reduce((n, p) => n + p.alsoOutsideFilters, 0);
    const msg = lockCount > 0
      ? `This locks ${lockCount} pay ${lockCount === 1 ? "group" : "groups"} (${preview.toLock.map((p) => p.name).join(", ")}) and every timecard in them${outside > 0 ? `, including ${outside} outside your filters` : ""}, posts their accruals and approved leave, then generates the ADP file for ${preview.summary.employees} employees.\n\nContinue?`
      : `These pay groups are already locked. Generate the ADP file for ${preview.summary.employees} employees?`;
    if (!confirm(msg)) return;
    setError(null);
    startTransition(async () => {
      const r = await processPayrollRun(input);
      if (!r.success) return setError(r.error);
      saveRunCodes(codes);
      setResult(r.data);
      setPreview(null);
      download(r.data.csv, r.data.filename);
    });
  }

  const summary = result?.summary ?? preview?.summary ?? null;
  const otherMinutes = summary ? summary.byCode.reduce((n, c) => n + c.minutes, 0) : 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Run Payroll</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Lock a pay period and build the ADP import file</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={runPreview}
            disabled={isPending || !periodKey}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {isPending ? "Working…" : "Preview"}
          </button>
          <button
            onClick={runProcess}
            disabled={isPending || !preview}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Process
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}

        <div className={panelCls}>
          <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-white">Pay period and file</h2>
          <p className="mb-4 text-xs text-zinc-500">Every pay group on these dates is included; use the filters to narrow who goes in the file.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-4">
              <Field label="Pay period">
                <select value={periodKey} onChange={(e) => { setPeriodKey(e.target.value); setPreview(null); setResult(null); }} className={inputCls}>
                  {periodGroups.map((g) => {
                    const locked = g.periods.filter((p) => p.status === "LOCKED").length;
                    const cards = g.periods.reduce((n, p) => n + p.timecards, 0);
                    return (
                      <option key={g.key} value={g.key}>
                        {g.label} · {g.periods.length} pay {g.periods.length === 1 ? "group" : "groups"} · {cards} timecards
                        {locked === g.periods.length ? " · Locked" : locked > 0 ? ` · ${locked} locked` : ""}
                      </option>
                    );
                  })}
                </select>
              </Field>
              {group && (
                <p className="mt-1.5 text-xs text-zinc-400">
                  {group.periods.filter((p) => p.timecards > 0).map((p) => `${p.name}${p.status === "LOCKED" ? " (locked)" : ""}`).join(" · ")}
                </p>
              )}
            </div>
            <Field label="Co Code" hint="ADP company code, on every row">
              <input value={codes.coCode} onChange={(e) => setCode("coCode", e.target.value)} placeholder="e.g. ATW" className={inputCls} />
            </Field>
            <Field label="Batch ID">
              <input value={codes.batchId} onChange={(e) => setCode("batchId", e.target.value)} placeholder="e.g. BATCH1" className={inputCls} />
            </Field>
            <Field label="Double time code" hint="Needed when the period has double time">
              <input value={codes.doubleTimeCode} onChange={(e) => setCode("doubleTimeCode", e.target.value)} placeholder="ADP hours code" className={inputCls} />
            </Field>
            <Field label="Meal penalty code">
              <input value={codes.mealPenaltyCode} onChange={(e) => setCode("mealPenaltyCode", e.target.value)} placeholder="MP" className={inputCls} />
            </Field>
          </div>
        </div>

        <div className={panelCls}>
          <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-white">Filters</h2>
          <p className="mb-4 text-xs text-zinc-500">Filters use each employee&apos;s current setup.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MultiSelectFilter label="Site" value={filters.siteIds} onChange={(v) => setFilter("siteIds", v)} options={sites} />
            <MultiSelectFilter label="Department" value={filters.departmentIds} onChange={(v) => setFilter("departmentIds", v)} options={departments} />
            <MultiSelectFilter label="Rule set (pay policy)" value={filters.ruleSetIds} onChange={(v) => setFilter("ruleSetIds", v)} options={ruleSets} />
            <MultiSelectFilter label="Pay category" value={filters.payCategoryIds} onChange={(v) => setFilter("payCategoryIds", v)} options={payCategories} />
            <MultiSelectFilter label="Agency" value={filters.agencyIds} onChange={(v) => setFilter("agencyIds", v)} options={agencies} />
            <Field label="Employees">
              <input value={filters.badgeIds} onChange={(e) => setFilter("badgeIds", e.target.value)} placeholder="All, or Badge IDs: 636554, 630622" className={inputCls} />
            </Field>
          </div>
        </div>

        {result && (
          <Notice tone="success">
            <div className="flex items-center justify-between gap-3">
              <span>
                <strong>Payroll file generated.</strong> {result.filename}: {result.summary.employees} employees, {result.summary.rows} rows.
                {result.locked ? ` Locked ${result.locked} pay ${result.locked === 1 ? "group" : "groups"}.` : ""}
              </span>
              <button onClick={() => download(result.csv, result.filename)} className="rounded-lg border border-green-300 px-3 py-1 text-xs font-medium hover:bg-green-100 dark:border-green-700 dark:hover:bg-green-900/40">
                Download again
              </button>
            </div>
          </Notice>
        )}

        {summary && (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                ["Employees", summary.employees.toLocaleString("en-US"), `${summary.rows} rows in the file`],
                ["Regular hours", hrs(summary.regMinutes), ""],
                ["Overtime hours", hrs(summary.otMinutes), ""],
                ["Other hours", hrs(otherMinutes), `${summary.byCode.length} ${summary.byCode.length === 1 ? "code" : "codes"}`],
              ].map(([label, value, sub]) => (
                <div key={label} className={panelCls}>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{value}</p>
                  {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
                </div>
              ))}
            </div>

            {summary.needsDoubleTimeCode && <Notice tone="error">This period has double time. Enter the ADP code for double time before processing.</Notice>}
            {summary.needsMealPenaltyCode && <Notice tone="error">This period has meal penalties. Enter the ADP code for meal penalty before processing.</Notice>}
            {summary.noBadge.length > 0 && (
              <Notice tone="warning">
                <strong>{summary.noBadge.length} {summary.noBadge.length === 1 ? "employee has" : "employees have"} hours but no Badge ID, and will be left out:</strong>{" "}
                {summary.noBadge.map((p) => `${p.name} (${hrs(p.minutes)} h)`).join(", ")}
              </Notice>
            )}
            {summary.leftOut.length > 0 && (
              <Notice tone="warning">
                <strong>Some hours have no export code and will be left out:</strong>{" "}
                {summary.leftOut.map((l) => `${l.label}: ${hrs(l.minutes)} h, ${l.people} ${l.people === 1 ? "person" : "people"}`).join(" · ")}
              </Notice>
            )}
            {summary.unlockedLeftOut > 0 && (
              <Notice tone="info">
                {summary.unlockedLeftOut} {summary.unlockedLeftOut === 1 ? "timecard is" : "timecards are"} unlocked for a correction and left out until locked again.
              </Notice>
            )}

            {summary.byCode.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <table className="w-full text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-zinc-500">Code</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-zinc-500">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byCode.map((c) => (
                      <tr key={c.code} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                        <td className="px-4 py-2 text-zinc-900 dark:text-white">{c.code}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{hrs(c.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
