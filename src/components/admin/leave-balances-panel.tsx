"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  postAccrualCorrection,
  postManualAccrualEntry,
  getLeaveTypeLedgerDetail,
  getAccrualYearSummary,
  type LedgerDetailEntry,
  type PastYearRow,
} from "@/actions/admin.actions";

interface BalanceRow {
  leaveTypeId: string;
  leaveTypeName: string;
  category: string;
  balanceMinutes: number;
  usedMinutes: number;
  accruedMinutes: number;
  approvedMinutes: number;
  pendingMinutes: number;
  postedMinutes: number;
  year: number;
  policyAnnualHours: number | null;
  policyName: string | null;
  policyRateMode: string | null;
  expectedAccrualMinutes: number | null;
  forecastedMinutes: number | null;
  forecastApplyToAvailable: boolean;
  netAdjustmentMinutes: number | null;
  accrualTracked: boolean;
}

interface Props {
  employeeId: string;
  balances: BalanceRow[];
  year: number;
  pastYears: number[];
}

const inputCls =
  "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const btnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

function fmtHours(minutes: number): string {
  if (minutes === 0) return "0h";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  const val = m === 0 ? `${h}h` : `${h}h ${m}m`;
  return minutes < 0 ? `-${val}` : val;
}

function fmtHoursPerYear(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h/yr` : `${hours.toFixed(1)}h/yr`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${parseInt(m)}/${parseInt(d)}/${y}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Sign toggle ──────────────────────────────────────────────────────────────

function SignToggle({ sign, onChange }: { sign: "+" | "-"; onChange: (s: "+" | "-") => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-600">
      {(["+", "-"] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={`w-7 py-1 text-xs font-bold font-mono transition-colors ${
            sign === s
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// ─── Add entry modal ──────────────────────────────────────────────────────────

function AddEntryForm({
  row,
  employeeId,
  onClose,
}: {
  row: BalanceRow;
  employeeId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [effectiveDate, setEffectiveDate] = useState(todayIso);
  const [accrualSign, setAccrualSign] = useState<"+" | "-">("+");
  const [accrualH, setAccrualH] = useState("");
  const [accrualM, setAccrualM] = useState("");
  const [adjustSign, setAdjustSign] = useState<"+" | "-">("+");
  const [adjustH, setAdjustH] = useState("");
  const [adjustM, setAdjustM] = useState("");
  const [note, setNote] = useState("");

  const rawAccrual = (parseInt(accrualH || "0", 10) || 0) * 60 + (parseInt(accrualM || "0", 10) || 0);
  const rawAdjust  = (parseInt(adjustH  || "0", 10) || 0) * 60 + (parseInt(adjustM  || "0", 10) || 0);
  const accrualMinutes = rawAccrual * (accrualSign === "+" ? 1 : -1);
  const adjustMinutes  = rawAdjust  * (adjustSign  === "+" ? 1 : -1);
  const totalDelta = accrualMinutes + adjustMinutes;
  const previewBalance = row.balanceMinutes + totalDelta;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await postManualAccrualEntry({
        employeeId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        effectiveDate,
        accrualMinutes,
        adjustMinutes,
        note,
      });
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      onClose();
      router.refresh();
    });
  }

  const canSave = note.trim().length > 0 && (accrualMinutes !== 0 || adjustMinutes !== 0);

  return (
    <form
      onSubmit={handleSave}
      className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50"
    >
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Add Entry — {row.leaveTypeName}
      </p>

      {/* Date */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-zinc-500">Effective Date</label>
        <input
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          className={inputCls}
        />
      </div>

      {/* Accrual Hours */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-zinc-500">Accrual Hours</label>
        <p className="mb-1.5 text-[10px] text-zinc-400">
          Adds to earned total — use for missed or catch-up postings
        </p>
        <div className="flex items-center gap-1.5">
          <SignToggle sign={accrualSign} onChange={setAccrualSign} />
          <input
            type="number"
            min={0}
            placeholder="0"
            value={accrualH}
            onChange={(e) => setAccrualH(e.target.value)}
            className={`w-16 ${inputCls}`}
          />
          <span className="text-xs text-zinc-400">h</span>
          <input
            type="number"
            min={0}
            max={59}
            placeholder="0"
            value={accrualM}
            onChange={(e) => setAccrualM(e.target.value)}
            className={`w-16 ${inputCls}`}
          />
          <span className="text-xs text-zinc-400">m</span>
        </div>
      </div>

      {/* Adjust Hours */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-zinc-500">Adjust Hours</label>
        <p className="mb-1.5 text-[10px] text-zinc-400">
          Direct balance adjustment — use for one-time grants or corrections
        </p>
        <div className="flex items-center gap-1.5">
          <SignToggle sign={adjustSign} onChange={setAdjustSign} />
          <input
            type="number"
            min={0}
            placeholder="0"
            value={adjustH}
            onChange={(e) => setAdjustH(e.target.value)}
            className={`w-16 ${inputCls}`}
          />
          <span className="text-xs text-zinc-400">h</span>
          <input
            type="number"
            min={0}
            max={59}
            placeholder="0"
            value={adjustM}
            onChange={(e) => setAdjustM(e.target.value)}
            className={`w-16 ${inputCls}`}
          />
          <span className="text-xs text-zinc-400">m</span>
        </div>
      </div>

      {/* Notes */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-zinc-500">Notes (required)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Catch-up for missed bi-weekly posting"
          required
          className={`w-full ${inputCls}`}
        />
      </div>

      {/* Preview */}
      {totalDelta !== 0 && (
        <div className="mb-3 rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-300">
          Balance{" "}
          <span className="font-medium">{fmtHours(row.balanceMinutes)}</span>
          {" → "}
          <span className={`font-medium ${previewBalance < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
            {fmtHours(previewBalance)}
          </span>
          {accrualMinutes !== 0 && (
            <span className="ml-3 text-zinc-400">
              Accrual: {accrualMinutes > 0 ? "+" : ""}{fmtHours(accrualMinutes)}
            </span>
          )}
          {adjustMinutes !== 0 && (
            <span className="ml-3 text-zinc-400">
              Adj: {adjustMinutes > 0 ? "+" : ""}{fmtHours(adjustMinutes)}
            </span>
          )}
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={isPending || !canSave} className={btnCls}>
          {isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Ledger drill-down ────────────────────────────────────────────────────────

type DetailResult = {
  openingBalance: number;
  availableYears: number[];
  entries: LedgerDetailEntry[];
};

function typeConfig(type: string, isFuture: boolean) {
  if (isFuture && type === "FORECAST") return { dot: "bg-indigo-400", text: "text-indigo-600 dark:text-indigo-400" };
  if (type === "LEAVE_REQUEST") return { dot: "bg-amber-400", text: "text-red-600 dark:text-red-400" };
  if (type === "ACCRUAL" || type === "CARRY_OVER") return { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" };
  if (type === "TIMECARD_DEDUCTION" || type === "USAGE") return { dot: "bg-red-400", text: "text-red-600 dark:text-red-400" };
  if (type === "FORFEITURE") return { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" };
  return { dot: "bg-zinc-400", text: "text-zinc-600 dark:text-zinc-300" };
}

function LedgerTable({ entries, openingBalance }: { entries: LedgerDetailEntry[]; openingBalance: number }) {
  if (entries.length === 0) {
    return <p className="py-4 text-center text-sm text-zinc-400">No activity this year.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700">
            <th className="pb-1.5 pr-3 text-left font-medium uppercase tracking-wide text-zinc-400">Date</th>
            <th className="pb-1.5 pr-3 text-left font-medium uppercase tracking-wide text-zinc-400">Type</th>
            <th className="pb-1.5 pr-3 text-right font-medium uppercase tracking-wide text-zinc-400">Hours</th>
            <th className="pb-1.5 text-right font-medium uppercase tracking-wide text-zinc-400">Available</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            <td className="py-1.5 pr-3 italic text-zinc-400">—</td>
            <td className="py-1.5 pr-3 italic text-zinc-400">Opening balance</td>
            <td className="py-1.5 pr-3 text-right text-zinc-400">—</td>
            <td className="py-1.5 text-right font-medium tabular-nums text-zinc-600 dark:text-zinc-300">
              {fmtHours(openingBalance)}
            </td>
          </tr>
          {entries.map((e) => {
            const cfg = typeConfig(e.type, e.isFuture);
            const sign = e.deltaMinutes > 0 ? "+" : "";
            return (
              <tr
                key={e.id}
                className={`border-b border-zinc-100 dark:border-zinc-800 ${e.isFuture ? "opacity-60" : ""}`}
              >
                <td className="py-1.5 pr-3 tabular-nums text-zinc-500">
                  {fmtDate(e.date)}
                  {e.isFuture && <span className="ml-1 text-[9px] uppercase text-zinc-400">proj.</span>}
                </td>
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} />
                    <span className="text-zinc-700 dark:text-zinc-200">{e.label}</span>
                    {e.status === "PENDING" && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        PENDING
                      </span>
                    )}
                    {e.note && (
                      <span className="max-w-[160px] truncate text-zinc-400" title={e.note}>
                        · {e.note}
                      </span>
                    )}
                  </span>
                </td>
                <td className={`py-1.5 pr-3 text-right tabular-nums font-medium ${cfg.text}`}>
                  {sign}{fmtHours(Math.abs(e.deltaMinutes))}
                </td>
                <td className="py-1.5 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">
                  {fmtHours(e.runningBalance)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LedgerDrillDown({
  employeeId,
  leaveTypeId,
  defaultYear,
}: {
  employeeId: string;
  leaveTypeId: string;
  defaultYear: number;
}) {
  const [selectedYear, setSelectedYear] = useState(defaultYear);
  const [result, setResult] = useState<DetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Map<number, DetailResult>>(new Map());

  useEffect(() => {
    const cached = cache.current.get(selectedYear);
    if (cached) { setResult(cached); return; }
    setLoading(true);
    setError(null);
    getLeaveTypeLedgerDetail({ employeeId, leaveTypeId, year: selectedYear })
      .then((res) => {
        if (res.success) { cache.current.set(selectedYear, res.data); setResult(res.data); }
        else setError((res as { success: false; error: string }).error);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, [employeeId, leaveTypeId, selectedYear]);

  const years = result?.availableYears ?? [defaultYear];

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40">
      <div className="flex gap-0 overflow-x-auto border-b border-zinc-200 dark:border-zinc-700">
        {years.map((y) => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            className={`shrink-0 px-3 py-1.5 text-xs font-medium transition-colors ${
              y === selectedYear
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {y}
          </button>
        ))}
      </div>
      <div className="p-3">
        {loading && <p className="py-4 text-center text-xs text-zinc-400">Loading…</p>}
        {error   && <p className="py-4 text-center text-xs text-red-500">{error}</p>}
        {!loading && !error && result && (
          <LedgerTable entries={result.entries} openingBalance={result.openingBalance} />
        )}
      </div>
    </div>
  );
}

// ─── Recalc section ───────────────────────────────────────────────────────────

function RecalcSection({ row, employeeId }: { row: BalanceRow; employeeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (row.expectedAccrualMinutes === null) return null;

  const delta = row.expectedAccrualMinutes - row.accruedMinutes;
  if (Math.abs(delta) < 2) {
    return (
      <p className="mt-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
        ✓ Accrual on track ({fmtHours(row.accruedMinutes)} accrued, {fmtHours(row.expectedAccrualMinutes)} expected)
      </p>
    );
  }

  function handlePost(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await postAccrualCorrection({
        employeeId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        deltaMinutes: delta,
        note,
      });
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          Accrual mismatch — expected {fmtHours(row.expectedAccrualMinutes)}, posted {fmtHours(row.accruedMinutes)} ({delta > 0 ? "+" : ""}{fmtHours(delta)})
        </p>
        {!open && (
          <button onClick={() => setOpen(true)} className="shrink-0 text-[10px] text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400">
            Post correction
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={handlePost} className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10">
          <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
            Posts an ADJUSTMENT of <strong>{delta > 0 ? "+" : ""}{fmtHours(delta)}</strong> to bring accrual to {fmtHours(row.expectedAccrualMinutes)}.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-52 flex-1">
              <label className="mb-1 block text-xs text-zinc-500">Reason (required)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Catch-up for missed semi-monthly posting" required className={`w-full ${inputCls}`} />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending || !note.trim()} className={btnCls}>
                {isPending ? "Posting…" : "Post correction"}
              </button>
              <button type="button" onClick={() => { setOpen(false); setError(null); setNote(""); }}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700">
                Cancel
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </form>
      )}
    </div>
  );
}

// ─── Balance row item ─────────────────────────────────────────────────────────

function BalanceRowItem({ row, employeeId }: { row: BalanceRow; employeeId: string }) {
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const forecastForAvail =
    row.forecastApplyToAvailable && row.forecastedMinutes != null ? row.forecastedMinutes : 0;
  const currentAvailable = row.balanceMinutes - row.approvedMinutes - row.pendingMinutes + forecastForAvail;

  return (
    <div className="border-b border-zinc-100 py-3 last:border-0 dark:border-zinc-800">
      {/* Clickable tile: name + metrics */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setLedgerOpen((v) => !v)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setLedgerOpen((v) => !v)}
        className="cursor-pointer select-none rounded-md -mx-1 px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
      >
        <div className="flex items-center gap-1">
          {ledgerOpen
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          }
          <span className="text-sm font-medium text-zinc-900 dark:text-white">
            {row.leaveTypeName}
          </span>
        </div>

        {/* Summary metrics */}
        <div className="mt-1.5 grid grid-cols-6 gap-3 pl-5 pr-2">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                {row.policyRateMode === "PER_POSTING" ? "Per Posting" : "Annual Total"}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {row.policyAnnualHours != null
                  ? row.policyRateMode === "PER_POSTING"
                    ? `${Number.isInteger(row.policyAnnualHours) ? row.policyAnnualHours : row.policyAnnualHours.toFixed(2).replace(/\.?0+$/, "")}h/post`
                    : fmtHoursPerYear(row.policyAnnualHours)
                  : <span className="text-xs font-normal text-zinc-400">No policy</span>
                }
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Accrued</p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{fmtHours(row.accruedMinutes)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Forecasted</p>
              {row.forecastedMinutes != null
                ? <p className="mt-0.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400">+{fmtHours(row.forecastedMinutes)}</p>
                : <p className="mt-0.5 text-sm font-semibold text-zinc-400 dark:text-zinc-600">N/A</p>
              }
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Net Adj.</p>
              {row.netAdjustmentMinutes !== null
                ? <p className={`mt-0.5 text-sm font-semibold ${row.netAdjustmentMinutes > 0 ? "text-emerald-600 dark:text-emerald-400" : row.netAdjustmentMinutes < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"}`}>
                    {row.netAdjustmentMinutes > 0 ? "+" : ""}{fmtHours(row.netAdjustmentMinutes)}
                  </p>
                : <p className="mt-0.5 text-sm font-semibold text-zinc-400 dark:text-zinc-600">N/A</p>
              }
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Approved</p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {fmtHours(row.approvedMinutes + row.postedMinutes)}
              </p>
              {row.pendingMinutes > 0 && <p className="text-[10px] text-zinc-400">{fmtHours(row.pendingMinutes)} pend.</p>}
              {row.postedMinutes > 0 && <p className="text-[10px] text-zinc-400">{fmtHours(row.postedMinutes)} timecard</p>}
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Available</p>
              <p className={`mt-0.5 text-sm font-semibold ${currentAvailable < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"}`}>
                {fmtHours(currentAvailable)}
              </p>
              {row.forecastApplyToAvailable && forecastForAvail > 0 && (
                <p className="text-[10px] text-indigo-500 dark:text-indigo-400">incl. projected</p>
              )}
            </div>
        </div>
      </div>

      {row.policyName && <RecalcSection row={row} employeeId={employeeId} />}

      {/* Expanded ledger section */}
      {ledgerOpen && (
        <div className="mt-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Activity</span>
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
            >
              <Plus className="h-3 w-3" />
              {addOpen ? "Cancel" : "Add"}
            </button>
          </div>
          {addOpen && (
            <AddEntryForm row={row} employeeId={employeeId} onClose={() => setAddOpen(false)} />
          )}
          <LedgerDrillDown employeeId={employeeId} leaveTypeId={row.leaveTypeId} defaultYear={row.year} />
        </div>
      )}
    </div>
  );
}

// ─── Past-year row (simplified) ───────────────────────────────────────────────

function PastYearRowItem({
  row,
  employeeId,
  year,
}: {
  row: PastYearRow;
  employeeId: string;
  year: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-zinc-100 py-3 last:border-0 dark:border-zinc-800">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((v) => !v)}
        className="-mx-1 cursor-pointer select-none rounded-md px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
      >
        <div className="flex items-center gap-1">
          {open
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          }
          <span className="text-sm font-medium text-zinc-900 dark:text-white">{row.leaveTypeName}</span>
        </div>
        <div className="mt-1.5 grid grid-cols-5 gap-3 pl-5 pr-2">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Carry-over</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              {row.carryOverMinutes > 0 ? `+${fmtHours(row.carryOverMinutes)}` : fmtHours(row.carryOverMinutes)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Accrued</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{fmtHours(row.accruedMinutes)}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Net Adj.</p>
            <p className={`mt-0.5 text-sm font-semibold ${row.adjustedMinutes > 0 ? "text-emerald-600 dark:text-emerald-400" : row.adjustedMinutes < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"}`}>
              {row.adjustedMinutes > 0 ? "+" : ""}{fmtHours(row.adjustedMinutes)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Used</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{fmtHours(row.usedMinutes)}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Final Balance</p>
            <p className={`mt-0.5 text-sm font-semibold ${row.finalBalanceMinutes < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"}`}>
              {fmtHours(row.finalBalanceMinutes)}
            </p>
          </div>
        </div>
      </div>
      {open && (
        <div className="mt-2">
          <LedgerDrillDown employeeId={employeeId} leaveTypeId={row.leaveTypeId} defaultYear={year} />
        </div>
      )}
    </div>
  );
}

// ─── Past-year accordion section ──────────────────────────────────────────────

function PastYearSection({ year, employeeId }: { year: number; employeeId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PastYearRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    if (!open && rows === null && !loading) {
      setLoading(true);
      setError(null);
      getAccrualYearSummary({ employeeId, year })
        .then((res) => {
          if (res.success) setRows(res.data as PastYearRow[]);
          else setError((res as { success: false; error: string }).error);
        })
        .catch(() => setError("Failed to load"))
        .finally(() => setLoading(false));
    }
    setOpen((v) => !v);
  }

  const tracked   = rows?.filter((r) => r.accrualTracked) ?? [];
  const untracked = rows?.filter((r) => !r.accrualTracked) ?? [];

  return (
    <div className="border-t border-zinc-100 dark:border-zinc-800">
      <button
        type="button"
        onClick={toggle}
        className="my-3 flex w-full items-center gap-2 text-left"
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
        }
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{year}</span>
        <div className="flex-1 border-t border-zinc-100 dark:border-zinc-800" />
      </button>
      {open && (
        <div>
          {loading && <p className="pb-3 text-xs text-zinc-400">Loading…</p>}
          {error   && <p className="pb-3 text-xs text-red-500">{error}</p>}
          {rows !== null && rows.length === 0 && (
            <p className="pb-3 text-xs text-zinc-400">No accrual data for {year}.</p>
          )}
          {tracked.map((row) => (
            <PastYearRowItem key={row.leaveTypeId} row={row} employeeId={employeeId} year={year} />
          ))}
          {untracked.length > 0 && (
            <div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">Other Leave Types</p>
              {untracked.map((row) => (
                <PastYearRowItem key={row.leaveTypeId} row={row} employeeId={employeeId} year={year} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function LeaveBalancesPanel({ employeeId, balances, year, pastYears }: Props) {
  const [currentYearOpen, setCurrentYearOpen] = useState(true);
  const [otherOpen, setOtherOpen] = useState(false);

  const tracked   = balances.filter((r) => r.accrualTracked);
  const untracked = balances.filter((r) => !r.accrualTracked);

  return (
    <div>
      {/* Current year — expanded by default */}
      <button
        type="button"
        onClick={() => setCurrentYearOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {currentYearOpen
          ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
        }
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{year}</span>
        <div className="flex-1 border-t border-zinc-100 dark:border-zinc-800" />
      </button>

      {currentYearOpen && (
        <div className="mt-1">
          {balances.length === 0 ? (
            <p className="py-3 text-sm text-zinc-400">
              No active leave types configured. Add leave types in{" "}
              <a href="/admin/leave-types" className="text-blue-600 hover:underline">Admin → Leave Types</a>.
            </p>
          ) : (
            <>
              {tracked.map((row) => (
                <BalanceRowItem key={row.leaveTypeId} row={row} employeeId={employeeId} />
              ))}
              {untracked.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setOtherOpen((v) => !v)}
                    className="my-3 flex w-full items-center gap-2 text-left"
                  >
                    {otherOpen ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                      Other Leave Types ({untracked.length})
                    </span>
                    <div className="flex-1 border-t border-zinc-100 dark:border-zinc-800" />
                  </button>
                  {otherOpen && untracked.map((row) => (
                    <BalanceRowItem key={row.leaveTypeId} row={row} employeeId={employeeId} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Past years — collapsed by default, lazy-loaded */}
      {pastYears.map((y) => (
        <PastYearSection key={y} year={y} employeeId={employeeId} />
      ))}
    </div>
  );
}
