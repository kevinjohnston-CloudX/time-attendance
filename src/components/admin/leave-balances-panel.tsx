"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustLeaveBalance, resetLeaveBalanceToAccrual } from "@/actions/admin.actions";

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
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtHoursPerYear(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h/yr` : `${hours.toFixed(1)}h/yr`;
}

function BalanceRow({ row, employeeId }: { row: BalanceRow; employeeId: string }) {
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
          <div className="mt-1.5 grid grid-cols-5 gap-3 pr-2">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Policy Total</p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {row.policyAnnualHours != null ? fmtHoursPerYear(row.policyAnnualHours) : <span className="text-zinc-400 font-normal text-xs">—</span>}
              </p>
              {row.policyName && <p className="text-[10px] text-zinc-400 truncate">{row.policyName}</p>}
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Accrued YTD</p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{fmtHours(row.accruedMinutes)}</p>
              {row.policyAnnualHours != null && (
                <p className="text-[10px] text-zinc-400">
                  of {fmtHoursPerYear(row.policyAnnualHours)}
                </p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Used YTD</p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{fmtHours(row.usedMinutes)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Balance</p>
              <p className={`mt-0.5 text-sm font-semibold ${
                row.balanceMinutes < 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-700 dark:text-zinc-200"
              }`}>
                {fmtHours(row.balanceMinutes)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Available</p>
              {(() => {
                const available = row.balanceMinutes - row.approvedMinutes - row.pendingMinutes;
                return (
                  <>
                    <p className={`mt-0.5 text-sm font-semibold ${
                      available < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"
                    }`}>
                      {fmtHours(available)}
                    </p>
                    {(row.approvedMinutes > 0 || row.pendingMinutes > 0) && (
                      <p className="text-[10px] text-zinc-400">
                        {[
                          row.approvedMinutes > 0 && `${fmtHours(row.approvedMinutes)} appr.`,
                          row.pendingMinutes > 0 && `${fmtHours(row.pendingMinutes)} pend.`,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
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
        <BalanceRow key={row.leaveTypeId} row={row} employeeId={employeeId} />
      ))}
    </div>
  );
}
