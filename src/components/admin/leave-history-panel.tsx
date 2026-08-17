"use client";

import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, FileDown } from "lucide-react";

export type LeaveLogEntry = {
  id: string;
  timestamp: string;
  eventType: "accrual" | "accrual_reset" | "leave_request" | "balance_adjustment" | "eod_balance" | "policy_change";
  leaveTypeName: string;
  deltaMinutes: number;
  balanceAfterMinutes: number;
  note: string | null;
  userName: string;
};

function fmtMins(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const val = m === 0 ? `${h}h` : `${h}h ${m}m`;
  return minutes < 0 ? `-${val}` : `+${val}`;
}

function fmtBalance(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const val = m === 0 ? `${h}h` : `${h}h ${m}m`;
  return minutes < 0 ? `-${val}` : val;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const TYPE_CONFIG = {
  accrual: {
    label: "Accrual",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  accrual_reset: {
    label: "Manual Adj. Clear",
    badge: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  },
  leave_request: {
    label: "Leave Request",
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  balance_adjustment: {
    label: "Balance Adjustment",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  eod_balance: {
    label: "EOD Balance",
    badge: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
  policy_change: {
    label: "Policy Change",
    badge: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  },
};

const selectCls =
  "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function LeaveHistoryPanel({ entries, defaultLeaveTypeNames = [] }: { entries: LeaveLogEntry[]; defaultLeaveTypeNames?: string[] }) {
  const currentYear = new Date().getFullYear();

  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [pickerYear, setPickerYear] = useState(currentYear);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [selectedLeaveTypes, setSelectedLeaveTypes] = useState<Set<string>>(() => new Set(defaultLeaveTypeNames));
  const [showLeaveTypePicker, setShowLeaveTypePicker] = useState(false);

  const pickerRef = useRef<HTMLDivElement>(null);
  const typePickerRef = useRef<HTMLDivElement>(null);
  const leaveTypePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    function onMouseDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showPicker]);

  useEffect(() => {
    if (!showTypePicker) return;
    function onMouseDown(e: MouseEvent) {
      if (typePickerRef.current && !typePickerRef.current.contains(e.target as Node)) setShowTypePicker(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showTypePicker]);

  useEffect(() => {
    if (!showLeaveTypePicker) return;
    function onMouseDown(e: MouseEvent) {
      if (leaveTypePickerRef.current && !leaveTypePickerRef.current.contains(e.target as Node)) setShowLeaveTypePicker(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showLeaveTypePicker]);

  const TYPE_OPTIONS = [
    { value: "accrual",            label: "Accrual" },
    { value: "accrual_reset",      label: "Manual Adj. Clear" },
    { value: "leave_request",      label: "Leave Request" },
    { value: "balance_adjustment", label: "Balance Adjustment" },
    { value: "eod_balance",        label: "EOD Balance" },
    { value: "policy_change",      label: "Policy Change" },
  ];

  function toggleType(value: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  }

  function toggleLeaveType(name: string) {
    setSelectedLeaveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const typeLabel =
    selectedTypes.size === 0
      ? "All Types"
      : selectedTypes.size === 1
      ? TYPE_OPTIONS.find((o) => o.value === [...selectedTypes][0])?.label ?? "1 selected"
      : `${selectedTypes.size} selected`;

  const leaveTypeLabel =
    selectedLeaveTypes.size === 0
      ? "All Leave Types"
      : selectedLeaveTypes.size === 1
      ? [...selectedLeaveTypes][0]
      : `${selectedLeaveTypes.size} selected`;

  const leaveTypeOptions = [...new Set([...defaultLeaveTypeNames, ...entries.map((e) => e.leaveTypeName)])].sort();

  const filtered = entries.filter((entry) => {
    if (new Date(entry.timestamp).getFullYear() !== selectedYear) return false;
    if (selectedTypes.size > 0 && !selectedTypes.has(entry.eventType)) return false;
    if (selectedLeaveTypes.size > 0 && !selectedLeaveTypes.has(entry.leaveTypeName)) return false;
    return true;
  });

  function handleExport() {
    const esc = (v: string) =>
      v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
    const headers = ["Type", "Leave Type", "Change", "Balance After", "Notes", "Date", "User"];
    const rows = filtered.map((entry) => [
      TYPE_CONFIG[entry.eventType].label,
      entry.leaveTypeName,
      entry.eventType === "eod_balance" ? "" : fmtMins(entry.deltaMinutes),
      fmtBalance(entry.balanceAfterMinutes),
      entry.note ?? "",
      fmtDate(entry.timestamp),
      entry.userName,
    ]);
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leave-history-${selectedYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Type multi-select */}
        <div className="relative" ref={typePickerRef}>
          <button
            type="button"
            onClick={() => setShowTypePicker((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <span className={selectedTypes.size > 0 ? "text-zinc-900 dark:text-white" : ""}>{typeLabel}</span>
            <ChevronDown className="h-3 w-3 text-zinc-400" />
          </button>

          {showTypePicker && (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-44 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => setSelectedTypes(new Set())}
                  className="w-full rounded-md px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                >
                  Clear all
                </button>
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleType(opt.value)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                      selectedTypes.has(opt.value)
                        ? "border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100"
                        : "border-zinc-300 dark:border-zinc-600"
                    }`}>
                      {selectedTypes.has(opt.value) && (
                        <svg className="h-2.5 w-2.5 text-white dark:text-zinc-900" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Leave type multi-select */}
        <div className="relative" ref={leaveTypePickerRef}>
          <button
            type="button"
            onClick={() => setShowLeaveTypePicker((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <span className={selectedLeaveTypes.size > 0 ? "text-zinc-900 dark:text-white" : ""}>
              {leaveTypeLabel}
            </span>
            <ChevronDown className="h-3 w-3 text-zinc-400" />
          </button>

          {showLeaveTypePicker && leaveTypeOptions.length > 0 && (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-44 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => setSelectedLeaveTypes(new Set())}
                  className="w-full rounded-md px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                >
                  Clear all
                </button>
                {leaveTypeOptions.map((lt) => (
                  <button
                    key={lt}
                    type="button"
                    onClick={() => toggleLeaveType(lt)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                      selectedLeaveTypes.has(lt)
                        ? "border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100"
                        : "border-zinc-300 dark:border-zinc-600"
                    }`}>
                      {selectedLeaveTypes.has(lt) && (
                        <svg className="h-2.5 w-2.5 text-white dark:text-zinc-900" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {lt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Year picker */}
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => { setPickerYear(selectedYear); setShowPicker((v) => !v); }}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <Calendar className="h-3.5 w-3.5" />
            {selectedYear}
          </button>

          {showPicker && (
            <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y - 1)}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                  {pickerYear}
                </span>
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y + 1)}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-white"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setSelectedYear(pickerYear); setShowPicker(false); }}
                className="mt-2.5 w-full rounded-md bg-zinc-900 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Select {pickerYear}
              </button>
            </div>
          )}
        </div>

        {/* Export */}
        <button
          type="button"
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          <FileDown className="h-3.5 w-3.5" />
          Export
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-400">No entries match the selected filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="pb-2 pr-4 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-400">Type</th>
                <th className="pb-2 pr-4 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-400">Leave Type</th>
                <th className="pb-2 pr-4 text-right text-[10px] font-medium uppercase tracking-wide text-zinc-400">Change</th>
                <th className="pb-2 pr-4 text-right text-[10px] font-medium uppercase tracking-wide text-zinc-400">Balance After</th>
                <th className="pb-2 pr-4 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-400">Notes</th>
                <th className="pb-2 pr-4 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-400">Date</th>
                <th className="pb-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-400">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filtered.map((entry) => {
                const cfg = TYPE_CONFIG[entry.eventType];
                const isPositive = entry.deltaMinutes >= 0;
                return (
                  <tr key={entry.id}>
                    <td className="py-2.5 pr-4 align-middle">
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${cfg.badge}`}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 align-middle text-sm text-zinc-600 dark:text-zinc-300">
                      {entry.leaveTypeName}
                    </td>
                    <td className="py-2.5 pr-4 text-right align-middle font-medium tabular-nums">
                      {entry.eventType === "eod_balance"
                        ? <span className="text-zinc-300 dark:text-zinc-600">—</span>
                        : entry.eventType === "policy_change"
                        ? <span className="text-purple-600 dark:text-purple-400">
                            {fmtBalance(entry.deltaMinutes)}/yr
                          </span>
                        : <span className={isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                            {fmtMins(entry.deltaMinutes)}
                          </span>
                      }
                    </td>
                    <td className="py-2.5 pr-4 text-right align-middle tabular-nums text-zinc-700 dark:text-zinc-200">
                      {fmtBalance(entry.balanceAfterMinutes)}
                    </td>
                    <td className="py-2.5 pr-4 align-middle text-zinc-500 dark:text-zinc-400">
                      {entry.note ?? <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 align-middle text-[11px] whitespace-nowrap text-zinc-400 dark:text-zinc-500">
                      {fmtDate(entry.timestamp)}
                    </td>
                    <td className="py-2.5 align-middle text-zinc-600 dark:text-zinc-300">
                      {entry.userName}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
