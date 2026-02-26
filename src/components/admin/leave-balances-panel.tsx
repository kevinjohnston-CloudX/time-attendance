"use client";

import { useState, useTransition } from "react";
import { adjustLeaveBalance, setAnnualLeaveDays } from "@/actions/admin.actions";

interface BalanceRow {
  leaveTypeId: string;
  leaveTypeName: string;
  category: string;
  balanceMinutes: number;
  usedMinutes: number;
  annualDaysEntitled: number | null;
  year: number;
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

function BalanceRow({ row, employeeId }: { row: BalanceRow; employeeId: string }) {
  const [panel, setPanel] = useState<"days" | "balance" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Annual days form state
  const [days, setDays] = useState(row.annualDaysEntitled ?? 0);

  // Balance adjustment state
  const [balHours, setBalHours] = useState(Math.floor(row.balanceMinutes / 60));
  const [balMins, setBalMins] = useState(row.balanceMinutes % 60);
  const [note, setNote] = useState("");

  function handleSaveDays(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await setAnnualLeaveDays({
        employeeId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        annualDays: days > 0 ? days : null,
      });
      if (!result.success) { setError(result.error); return; }
      setPanel(null);
    });
  }

  function handleSaveBalance(e: React.FormEvent) {
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
      setPanel(null);
      setNote("");
    });
  }

  return (
    <div className="border-b border-zinc-100 py-3 last:border-0 dark:border-zinc-800">
      {/* Summary */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-white">
            {row.leaveTypeName}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            Balance: <span className="font-medium text-zinc-600 dark:text-zinc-300">{fmtHours(row.balanceMinutes)}</span>
            {" · "}Used: {fmtHours(row.usedMinutes)}
            {row.annualDaysEntitled != null && (
              <>
                {" · "}
                <span className="font-medium text-blue-600 dark:text-blue-400">
                  {row.annualDaysEntitled} days/year
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 text-xs">
          <button
            onClick={() => setPanel(panel === "days" ? null : "days")}
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            {panel === "days" ? "Cancel" : "Set annual days"}
          </button>
          <span className="text-zinc-300 dark:text-zinc-600">|</span>
          <button
            onClick={() => setPanel(panel === "balance" ? null : "balance")}
            className="text-zinc-500 hover:underline dark:text-zinc-400"
          >
            {panel === "balance" ? "Cancel" : "Adjust balance"}
          </button>
        </div>
      </div>

      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}

      {/* Set annual days */}
      {panel === "days" && (
        <form onSubmit={handleSaveDays} className="mt-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-800/30 dark:bg-blue-900/10">
          <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Annual {row.leaveTypeName} days for {row.year}
          </p>
          <p className="mb-2 text-xs text-zinc-400">
            The system will spread this evenly across pay periods. Enter 0 to use the leave type default rate.
          </p>
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Days per year</label>
              <input
                type="number"
                min={0}
                max={365}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className={`w-20 ${inputCls}`}
              />
            </div>
            {days > 0 && (
              <p className="pb-1.5 text-xs text-zinc-400">
                = {fmtHours(days * 480)} per year
              </p>
            )}
            <button type="submit" disabled={isPending} className={btnCls}>
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}

      {/* Adjust current balance */}
      {panel === "balance" && (
        <form onSubmit={handleSaveBalance} className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
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
            <button type="submit" disabled={isPending || !note.trim()} className={btnCls}>
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
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
      <p className="mb-1 text-xs text-zinc-400">
        Set annual days per employee — the system accrues evenly each pay period.
      </p>
      <div>
        {balances.map((row) => (
          <BalanceRow key={row.leaveTypeId} row={row} employeeId={employeeId} />
        ))}
      </div>
    </div>
  );
}
