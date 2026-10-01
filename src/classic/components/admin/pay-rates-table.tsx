"use client";

import type { PayRateRow } from "@/actions/pay-rate.actions";
import { currentRow, money, noSubmitOnEnter, usDate, usePayRates } from "@/components/admin/use-pay-rates";

const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const btn =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** Pay rates from an effective date, as NovaTime's Pay Rates table, saved on its own. */
export function PayRatesTable({ employeeId, initial, salary }: { employeeId: string; initial: PayRateRow[]; salary: boolean }) {
  const { rows, draft, error, pending, edit, cancel, add, remove, update, save } = usePayRates(employeeId, initial);
  const current = currentRow(rows);

  const num = (key: string, field: "rate1" | "rate2" | "rate3", value: string, label: string) => (
    <input
      type="number"
      min="0.01"
      step="0.01"
      value={value}
      onChange={(e) => update(key, field, e.target.value)}
      onKeyDown={noSubmitOnEnter}
      placeholder="0.00"
      aria-label={label}
      className={`${inputCls} text-right tabular-nums`}
    />
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">Pay Rates</p>
          <p className="text-xs text-zinc-500">
            {current ? `Current: ${money(current.rate1)} ${salary ? "per year" : "per hour"}, since ${usDate(current.effectiveDate)}` : "No rate in effect yet"}
            {" · "}Rate 1 is the pay rate; Rates 2 and 3 are for reference.
          </p>
        </div>
        {draft ? (
          <div className="flex gap-2">
            <button type="button" onClick={add} disabled={pending} className={btn}>+ Add Rate</button>
            <button type="button" onClick={cancel} disabled={pending} className={btn}>Cancel</button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? "Saving…" : "Save Rates"}
            </button>
          </div>
        ) : (
          <button type="button" onClick={edit} className={btn}>Edit Pay Rates</button>
        )}
      </div>

      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 dark:bg-zinc-800">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-300">Date Effective</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-600 dark:text-zinc-300">Rate 1</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-600 dark:text-zinc-300">Rate 2</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-600 dark:text-zinc-300">Rate 3</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-300">Notes</th>
              {draft && <th className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>}
            </tr>
          </thead>
          <tbody>
            {draft
              ? draft.map((r) => (
                  <tr key={r.key} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="min-w-[150px] px-3 py-1.5">
                      <input type="date" value={r.effectiveDate} onChange={(e) => update(r.key, "effectiveDate", e.target.value)} onKeyDown={noSubmitOnEnter} aria-label="Date effective" className={inputCls} />
                    </td>
                    <td className="min-w-[100px] px-3 py-1.5">{num(r.key, "rate1", r.rate1, "Rate 1")}</td>
                    <td className="min-w-[100px] px-3 py-1.5">{num(r.key, "rate2", r.rate2, "Rate 2")}</td>
                    <td className="min-w-[100px] px-3 py-1.5">{num(r.key, "rate3", r.rate3, "Rate 3")}</td>
                    <td className="min-w-[180px] px-3 py-1.5">
                      <input value={r.note} maxLength={500} onChange={(e) => update(r.key, "note", e.target.value)} onKeyDown={noSubmitOnEnter} placeholder="e.g. Annual increase" aria-label="Notes" className={inputCls} />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button type="button" onClick={() => remove(r.key)} aria-label="Remove this rate" title="Remove this rate" className="text-zinc-400 hover:text-red-600">✕</button>
                    </td>
                  </tr>
                ))
              : rows.map((r) => (
                  <tr key={r.effectiveDate} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2 text-zinc-900 dark:text-white">
                      {usDate(r.effectiveDate)}
                      {current?.effectiveDate === r.effectiveDate && <span className="ml-2 text-xs text-green-600 dark:text-green-400">Current</span>}
                      {current && r.effectiveDate > current.effectiveDate && <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">Upcoming</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-white">{money(r.rate1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{money(r.rate2) || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{money(r.rate3) || "—"}</td>
                    <td className="max-w-[320px] truncate px-3 py-2 text-zinc-500" title={r.note ?? undefined}>{r.note || "—"}</td>
                  </tr>
                ))}
            {!draft && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-zinc-400">No pay rates yet. Use Edit Pay Rates to add one.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
