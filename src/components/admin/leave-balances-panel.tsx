"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  forecastedMinutes: number | null;
  forecastApplyToAvailable: boolean;
  netAdjustmentMinutes: number | null;
  accrualTracked: boolean;
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

type AdjustMode = "ADD" | "SUBTRACT" | "SET_AVAILABLE";

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

  const [mode, setMode] = useState<AdjustMode>("ADD");
  const [adjHours, setAdjHours] = useState<string>("");
  const [adjMins, setAdjMins] = useState<string>("");
  const [note, setNote] = useState("");

  const enteredMinutes = (parseInt(adjHours || "0", 10) || 0) * 60 + (parseInt(adjMins || "0", 10) || 0);

  const forecastForAvail =
    row.forecastApplyToAvailable && row.forecastedMinutes != null ? row.forecastedMinutes : 0;

  const newBalanceMinutes = (() => {
    if (mode === "ADD") return row.balanceMinutes + enteredMinutes;
    if (mode === "SUBTRACT") return row.balanceMinutes - enteredMinutes;
    // SET_AVAILABLE: available = balance - approved - pending + forecastForAvail
    // → balance = entered + approved + pending - forecastForAvail
    return enteredMinutes + row.approvedMinutes + row.pendingMinutes - forecastForAvail;
  })();

  const previewAvailable =
    newBalanceMinutes - row.approvedMinutes - row.pendingMinutes + forecastForAvail;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await adjustLeaveBalance({
        employeeId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        mode,
        enteredMinutes,
        newBalanceMinutes,
        note,
      });
      if (!result.success) { setError(result.error); return; }
      setOpen(false);
      setNote("");
      setAdjHours("");
      setAdjMins("");
      setMode("ADD");
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

  const currentAvailable =
    row.balanceMinutes - row.approvedMinutes - row.pendingMinutes + forecastForAvail;

  return (
    <div className="border-b border-zinc-100 py-3 last:border-0 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-white">{row.leaveTypeName}</p>
          <div className="mt-1.5 grid grid-cols-6 gap-3 pr-2">
            {/* Annual Total / Per Posting */}
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

            {/* Accrued */}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Accrued</p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {fmtHours(row.accruedMinutes)}
              </p>
            </div>

            {/* Forecasted */}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Forecasted</p>
              {row.forecastedMinutes != null ? (
                <p className="mt-0.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                  +{fmtHours(row.forecastedMinutes)}
                </p>
              ) : (
                <p className="mt-0.5 text-sm font-semibold text-zinc-400 dark:text-zinc-600">N/A</p>
              )}
            </div>

            {/* Net Adjustments */}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Net Adj.</p>
              {row.netAdjustmentMinutes !== null ? (
                <p className={`mt-0.5 text-sm font-semibold ${
                  row.netAdjustmentMinutes > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : row.netAdjustmentMinutes < 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-zinc-700 dark:text-zinc-200"
                }`}>
                  {row.netAdjustmentMinutes > 0 ? "+" : ""}{fmtHours(row.netAdjustmentMinutes)}
                </p>
              ) : (
                <p className="mt-0.5 text-sm font-semibold text-zinc-400 dark:text-zinc-600">N/A</p>
              )}
            </div>

            {/* Approved */}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Approved</p>
              <p className="mt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {fmtHours(row.approvedMinutes)}
              </p>
              {row.pendingMinutes > 0 && (
                <p className="text-[10px] text-zinc-400">{fmtHours(row.pendingMinutes)} pend.</p>
              )}
            </div>

            {/* Available */}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Available</p>
              {(() => {
                const available = currentAvailable;
                return (
                  <>
                    <p className={`mt-0.5 text-sm font-semibold ${
                      available < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"
                    }`}>
                      {fmtHours(available)}
                    </p>
                    {row.forecastApplyToAvailable && forecastForAvail > 0 && (
                      <p className="text-[10px] text-indigo-500 dark:text-indigo-400">incl. projected</p>
                    )}
                  </>
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
              {isResetting ? "Clearing…" : "Clear manual adj."}
            </button>
          </div>
        )}
        {error && !open && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      {open && (
        <form onSubmit={handleSave} className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
          {/* Mode selector */}
          <div className="mb-3 flex gap-1">
            {(["ADD", "SUBTRACT", "SET_AVAILABLE"] as const).map((m) => {
              const label = m === "ADD" ? "Add hours" : m === "SUBTRACT" ? "Subtract hours" : "Set available";
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    mode === m
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Hours</label>
              <input
                type="number"
                min={0}
                placeholder="0"
                value={adjHours}
                onChange={(e) => setAdjHours(e.target.value)}
                className={`w-20 ${inputCls}`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Minutes</label>
              <input
                type="number"
                min={0}
                max={59}
                placeholder="0"
                value={adjMins}
                onChange={(e) => setAdjMins(e.target.value)}
                className={`w-20 ${inputCls}`}
              />
            </div>
            <div className="min-w-40 flex-1">
              <label className="mb-1 block text-xs text-zinc-500">Reason (required)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Opening balance carry-over"
                required
                className={`w-full ${inputCls}`}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending || !note.trim() || enteredMinutes === 0} className={btnCls}>
                {isPending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null); setNote(""); setAdjHours(""); setAdjMins(""); setMode("ADD"); }}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>

          {/* Preview */}
          {enteredMinutes > 0 && (
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              {mode === "ADD" && <>Balance <span className="font-medium text-zinc-700 dark:text-zinc-200">{fmtHours(row.balanceMinutes)}</span> → <span className="font-medium text-emerald-600 dark:text-emerald-400">{fmtHours(newBalanceMinutes)}</span> · Available will be <span className="font-medium">{fmtHours(previewAvailable)}</span></>}
              {mode === "SUBTRACT" && <>Balance <span className="font-medium text-zinc-700 dark:text-zinc-200">{fmtHours(row.balanceMinutes)}</span> → <span className={`font-medium ${newBalanceMinutes < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"}`}>{fmtHours(newBalanceMinutes)}</span> · Available will be <span className={`font-medium ${previewAvailable < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{fmtHours(previewAvailable)}</span></>}
              {mode === "SET_AVAILABLE" && <>Available <span className="font-medium text-zinc-700 dark:text-zinc-200">{fmtHours(currentAvailable)}</span> → <span className="font-medium text-emerald-600 dark:text-emerald-400">{fmtHours(enteredMinutes)}</span> · Balance will be <span className="font-medium">{fmtHours(newBalanceMinutes)}</span></>}
            </p>
          )}

          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </form>
      )}
    </div>
  );
}

export function LeaveBalancesPanel({ employeeId, balances, year }: Props) {
  const [otherOpen, setOtherOpen] = useState(false);

  if (balances.length === 0) {
    return (
      <p className="mt-2 text-sm text-zinc-400">
        No active leave types configured. Add leave types in{" "}
        <a href="/admin/leave-types" className="text-blue-600 hover:underline">Admin → Leave Types</a>.
      </p>
    );
  }

  const tracked = balances.filter((r) => r.accrualTracked);
  const untracked = balances.filter((r) => !r.accrualTracked);

  return (
    <div>
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
            {otherOpen
              ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
            }
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
    </div>
  );
}
