"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  previewPayrollRun,
  processPayrollRun,
  draftPayrollFile,
  type RunFrequency,
  type RunPeriod,
  type RunPayrollInput,
  type RunPreview,
} from "@/actions/payroll-run.actions";
import type { EpiSummary } from "@/lib/payroll/adp-epi";
import { saveRunCodes, type RunCodes } from "@/lib/payroll/run-codes";
import { MultiSelectFilter } from "@/classic/components/payroll/multi-select-filter";
import { fmtDay, includedDates } from "@/lib/payroll/run-range";

type Option = { id: string; name: string };

interface Props {
  frequencies: RunFrequency[];
  periods: RunPeriod[];
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

export function RunPayrollScreen({ frequencies, periods, ruleSets, payCategories, sites, departments, agencies, savedCodes }: Props) {
  const [isPending, startTransition] = useTransition();
  const initial = frequencies.find((f) => f.value === "BIWEEKLY") ?? frequencies[0];
  const [frequency, setFrequency] = useState<string>(initial?.value ?? "BIWEEKLY");
  const [from, setFrom] = useState(initial?.defaultFrom ?? "");
  const [to, setTo] = useState(initial?.defaultTo ?? "");
  const [codes, setCodes] = useState<RunCodes>(savedCodes);
  const [filters, setFilters] = useState({ badgeIds: "", ruleSetIds: [] as string[], payCategoryIds: [] as string[], siteIds: [] as string[], departmentIds: [] as string[], agencyIds: [] as string[], excludeMissedPunches: false });
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [result, setResult] = useState<{ csv: string; filename: string; summary: EpiSummary; locked: number; leftOpen: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const included = useMemo(() => includedDates(periods, frequency, from, to), [periods, frequency, from, to]);
  const freqLabel = frequencies.find((f) => f.value === frequency)?.label.toLowerCase() ?? "";
  const input: RunPayrollInput = useMemo(
    () => ({ frequency: frequency as RunPayrollInput["frequency"], from, to, filters, codes }),
    [frequency, from, to, filters, codes],
  );

  function changeFrequency(value: string) {
    const f = frequencies.find((x) => x.value === value);
    setFrequency(value);
    setFrom(f?.defaultFrom ?? "");
    setTo(f?.defaultTo ?? "");
    setPreview(null);
    setResult(null);
  }
  const changeDate = (set: (v: string) => void, v: string) => {
    set(v);
    setPreview(null);
    setResult(null);
  };

  const setCode = (k: keyof RunCodes, v: string) => { setCodes((c) => ({ ...c, [k]: v.toUpperCase() })); setPreview(null); };
  const setFilter = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) => { setFilters((f) => ({ ...f, [k]: v })); setPreview(null); };

  function runDraft() {
    setError(null);
    startTransition(async () => {
      const r = await draftPayrollFile(input);
      if (!r.success) return setError(r.error);
      download(r.data.csv, r.data.filename);
    });
  }

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
    const missedInFile = preview.summary.missedPunches.filter((m) => !m.excluded).length;
    const missedLeftOut = preview.summary.missedPunches.filter((m) => m.excluded).length;
    const warn = missedInFile > 0
      ? `\n\n${missedInFile} ${missedInFile === 1 ? "timecard in the file has" : "timecards in the file have"} open missed punches, so their hours may be wrong.`
      : "";
    const msg = lockCount > 0
      ? `This locks ${lockCount} pay ${lockCount === 1 ? "group" : "groups"} (${preview.toLock.map((p) => p.name).join(", ")}) and every timecard in them${outside > 0 ? `, including ${outside} outside your filters` : ""}${missedLeftOut > 0 ? `, except the ${missedLeftOut} left out for missed punches` : ""}, posts their accruals and approved leave, then generates the ADP file for ${preview.summary.employees} employees.${warn}\n\n${missedInFile > 0 ? "Process anyway?" : "Continue?"}`
      : `These pay groups are already locked. Generate the ADP file for ${preview.summary.employees} employees?${warn}`;
    if (!confirm(msg)) return;
    setError(null);
    startTransition(async () => {
      const r = await processPayrollRun({ ...input, acknowledgeMissedPunches: true });
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
            disabled={isPending || included.length === 0}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {isPending ? "Working…" : "Preview"}
          </button>
          <button
            onClick={runDraft}
            disabled={isPending || included.length === 0}
            title="The file Process would build, without locking anything"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Download draft file
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
          <p className="mb-4 text-xs text-zinc-500">Every pay group of this frequency inside the dates is included; use the filters to narrow who goes in the file.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Pay frequency">
              <select value={frequency} onChange={(e) => changeFrequency(e.target.value)} className={inputCls}>
                {frequencies.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="From">
              <input type="date" value={from} max={to || undefined} onChange={(e) => changeDate(setFrom, e.target.value)} className={inputCls} />
            </Field>
            <Field label="To">
              <input type="date" value={to} min={from || undefined} onChange={(e) => changeDate(setTo, e.target.value)} className={inputCls} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              {included.length === 0 ? (
                <p className="text-sm text-amber-600 dark:text-amber-400">No {freqLabel} pay periods fall entirely inside these dates.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm text-zinc-500">
                  {included.map((g) => (
                    <li key={g.startDay}>
                      <span className="font-medium text-zinc-900 dark:text-white">{fmtDay(g.startDay)} to {fmtDay(g.lastDay)}</span>
                      {` · ${g.timecards} timecards`}
                      {g.locked > 0 && (g.locked === g.names.length ? " · locked" : ` · ${g.locked} of ${g.names.length} locked`)}
                      <span className="text-zinc-400">{` · ${g.names.join(", ")}`}</span>
                    </li>
                  ))}
                </ul>
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
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={filters.excludeMissedPunches}
                  onChange={(e) => setFilter("excludeMissedPunches", e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                Leave out people with open missed punches
              </label>
              <p className="mt-1 text-xs text-zinc-400">Their timecards stay unlocked so they can be corrected, locked and run later.</p>
            </div>
          </div>
        </div>

        {result && (
          <Notice tone="success">
            <div className="flex items-center justify-between gap-3">
              <span>
                <strong>Payroll file generated.</strong> {result.filename}: {result.summary.employees} employees, {result.summary.rows} rows.
                {result.locked ? ` Locked ${result.locked} pay ${result.locked === 1 ? "group" : "groups"}.` : ""}
                {result.leftOpen ? ` ${result.leftOpen} ${result.leftOpen === 1 ? "timecard was" : "timecards were"} left out for missed punches and kept unlocked.` : ""}
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
                <strong>Some hours are on pay codes with no Express code, and will be left out. Add one under Company Setup → Pay Codes:</strong>{" "}
                {summary.leftOut.map((l) => `${l.label}: ${hrs(l.minutes)} h, ${l.people} ${l.people === 1 ? "person" : "people"}`).join(" · ")}
              </Notice>
            )}
            {summary.unlockedLeftOut > 0 && (
              <Notice tone="info">
                {summary.unlockedLeftOut} {summary.unlockedLeftOut === 1 ? "timecard is" : "timecards are"} unlocked for a correction and left out until locked again.
              </Notice>
            )}

            {summary.openExceptions.length > 0 && (
              <div className={panelCls}>
                <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-white">Open exceptions</h2>
                <p className="mb-3 text-xs text-zinc-500">
                  {summary.missedPunches.length > 0
                    ? "Missed punches change the hours: the day pays as punched and doesn't count toward overtime. Correct them before processing, or leave those people out with the filter above."
                    : "None of these change the hours in the file."}
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-500">
                  {summary.openExceptions.map((e) => (
                    <span key={e.type}>
                      <span className={e.type === "MISSING_PUNCH" ? "font-medium text-amber-700 dark:text-amber-400" : "font-medium text-zinc-900 dark:text-white"}>{e.label}</span>
                      {` ${e.count.toLocaleString("en-US")} on ${e.people.toLocaleString("en-US")} ${e.people === 1 ? "person" : "people"}`}
                    </span>
                  ))}
                </div>
                {summary.missedPunches.length > 0 && (
                  <div className="mt-4 max-h-[360px] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-zinc-500">Employee</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-zinc-500">Badge ID</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-zinc-500">Missed punches</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-zinc-500">In the file</th>
                          <th className="px-4 py-2"><span className="sr-only">Timecard</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.missedPunches.map((m) => (
                          <tr key={m.timesheetId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                            <td className="px-4 py-2 text-zinc-900 dark:text-white">{m.name}</td>
                            <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{m.file}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{m.count}</td>
                            <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{m.excluded ? "Left out" : "Yes"}</td>
                            <td className="px-4 py-2 text-right">
                              <Link href={`/payroll/timecards?periodId=${m.payPeriodId}&employeeId=${m.employeeId}`} target="_blank" className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                                Open timecard
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
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
