"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustLeaveBalance, resetLeaveBalanceToAccrual, postAccrualCorrection } from "@/actions/admin.actions";

interface BalanceRow {
  leaveTypeId: string;
  leaveTypeName: string;
  category: string;
  balanceMinutes: number;
  usedMinutes: number;
  accruedMinutes: number;
  approvedMinutes: number;
  pendingMinutes: number;
  year: number;
  policyAnnualHours: number | null;
  policyName: string | null;
  policyRateMode: string | null;
  expectedAccrualMinutes: number | null;
}

interface Props {
  employeeId: string;
  balances: BalanceRow[];
  year: number;
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

function RecalcSection({ row, employeeId }: { row: BalanceRow; employeeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (row.expectedAccrualMinutes === null) {
    return (
      <p className="mt-1.5 text-[10px] text-zinc-400">
        Accrual recalculation N/A — driven by pay period postings.
      </p>
    );
  }

  const delta = row.expectedAccrualMinutes - row.accruedMinutes;
  const onTrack = Math.abs(delta) < 2;

  if (onTrack) {
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
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 text-[10px] text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400"
          >
            Post correction
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={handlePost} className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10">
          <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
            This will post an ADJUSTMENT of <strong>{delta > 0 ? "+" : ""}{fmtHours(delta)}</strong> to bring the accrual to {fmtHours(row.expectedAccrualMinutes)}.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-52 flex-1">
              <label className="mb-1 block text-xs text-zinc-500">Reason (required)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Catch-up for missed semi-monthly posting"
                required
                className={`w-full ${inputCls}`}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending || !note.trim()} className={btnCls}>
                {isPending ? "Posting…" : "Post correction"}
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null); setNote(""); }}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
              >
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

function BalanceRowItem({ row, employeeId }: { row: BalanceRow; employeeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isResetting, startResetTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [balHours, setBalHours] = useState(Math.floor(row.balanceMinutes / 60));
  const [balMins, setBalMins] = useState(row.balanceMinutes % 60);
  const [note, setNote] = useState("");

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await adjustLeaveBalance({
        employeeId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        newBalanceMinutes: balHours * 60 + balMins,
        note,
      });
      if (!result.success) { setError(result.error); return; }
      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  function handleReset() {
    setError(null);
    startResetTransition(async () => {
      const result = await resetLeaveBalanceToAccrual({
        employeeId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
      });
      if (!result.success) { setError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="border-b border-zinc-100 py-3 last:border-0 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-white">{row.leaveTypeName}</p>
          <div className="mt-1.5 grid grid-cols-4 gap-3 pr-2">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                {row.policyRateMode === "PER_POSTING" ? "Per Posting" : "Annual Total"}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {row.policyAnnualHours != null
                  ? row.policyRateMode === "PER_POSTING"
                    ? `${Number.isInteger(row.policyAnnualHours) ? row.policyAnnualHours : row.policyAnnualHours.toFixed(2).replace(/\.?0+$/, "")}h/post`
                    : fmtHoursPerYear(row.policyAnnualHours)
                  : <span className="font-normal text-xs text-zinc-400">No policy</span>
                }
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Accrued</p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {fmtHours(row.accruedMinutes)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Approved</p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {fmtHours(row.approvedMinutes)}
              </p>
              {row.pendingMinutes > 0 && (
                <p className="text-[10px] text-zinc-400">{fmtHours(row.pendingMinutes)} pend.</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Available</p>
              {(() => {
                const available = row.balanceMinutes - row.approvedMinutes - row.pendingMinutes;
                return (
                  <p className={`mt-0.5 text-sm font-semibold ${
                    available < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"
                  }`}>
                    {fmtHours(available)}
                  </p>
                );
              })()}
            </div>
          </div>

          {row.policyName && (
            <RecalcSection row={row} employeeId={employeeId} />
          )}
        </div>
        {!open && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              onClick={() => { setOpen(true); setError(null); }}
              className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
            >
              Adjust balance
            </button>
            <button
              onClick={handleReset}
              disabled={isResetting}
              className="text-xs text-zinc-400 hover:underline disabled:opacity-50 dark:text-zinc-500"
              title="Reverse all manual adjustments this year and restore the accrual-calculated balance"
            >
              {isResetting ? "Resetting…" : "Reset to accrual"}
            </button>
          </div>
        )}
        {error && !open && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      {open && (
        <form onSubmit={handleSave} className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
          <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Set current balance for {row.year}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Hours</label>
              <input type="number" min={0} value={balHours} onChange={(e) => setBalHours(Number(e.target.value))} className={`w-20 ${inputCls}`} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Minutes</label>
              <select value={balMins} onChange={(e) => setBalMins(Number(e.target.value))} className={`w-24 ${inputCls}`}>
                <option value={0}>0 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
              </select>
            </div>
            <div className="min-w-40 flex-1">
              <label className="mb-1 block text-xs text-zinc-500">Reason (required)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Opening balance for 2026" required className={`w-full ${inputCls}`} />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending || !note.trim()} className={btnCls}>
                {isPending ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => { setOpen(false); setError(null); setNote(""); }} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700">
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

export function LeaveBalancesPanel({ employeeId, balances, year }: Props) {
  if (balances.length === 0) {
    return (
      <p className="mt-2 text-sm text-zinc-400">
        No active leave types configured. Add leave types in{" "}
        <a href="/admin/leave-types" className="text-blue-600 hover:underline">Admin → Leave Types</a>.
      </p>
    );
  }

  return (
    <div>
      {balances.map((row) => (
        <BalanceRowItem key={row.leaveTypeId} row={row} employeeId={employeeId} />
      ))}
    </div>
  );
}
