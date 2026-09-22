"use client";

import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, FileDown } from "lucide-react";
import { Badge, Table, THead, TBody, TR, TH, TD, type BadgeTone } from "@/components/ui";

export type LeaveLogEntry = {
  id: string;
  timestamp: string;
  eventType: "accrual" | "accrual_reset" | "leave_request" | "balance_adjustment" | "eod_balance" | "policy_change" | "timecard_entry";
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

/**
 * What each ledger event is called and what colour it carries.
 *
 * <p>`label` is also the CSV export's value for this column, so it stays a
 * plain string. Only the colour moved: it was seven hand-written Tailwind
 * pairs, two of which (violet, purple) are indistinguishable at badge size.
 */
const TYPE_CONFIG: Record<string, { label: string; tone: BadgeTone }> = {
  accrual: { label: "Accrual", tone: "success" },
  accrual_reset: { label: "Manual Adj. Clear", tone: "purple" },
  leave_request: { label: "Leave Request", tone: "warning" },
  balance_adjustment: { label: "Balance Adjustment", tone: "info" },
  eod_balance: { label: "EOD Balance", tone: "neutral" },
  policy_change: { label: "Policy Change", tone: "purple" },
  timecard_entry: { label: "Time Card Entry", tone: "warning" },
};

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
    { value: "timecard_entry",     label: "Time Card Entry" },
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
            <span className={selectedTypes.size > 0 ? "text-[var(--text-primary)]" : ""}>{typeLabel}</span>
            <ChevronDown className="h-3 w-3 text-zinc-400" />
          </button>

          {showTypePicker && (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-44 rounded-lg ta-modal">
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
                        : "border-[var(--stroke-default)]"
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
            <span className={selectedLeaveTypes.size > 0 ? "text-[var(--text-primary)]" : ""}>
              {leaveTypeLabel}
            </span>
            <ChevronDown className="h-3 w-3 text-zinc-400" />
          </button>

          {showLeaveTypePicker && leaveTypeOptions.length > 0 && (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-44 rounded-lg ta-modal">
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
                        : "border-[var(--stroke-default)]"
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
            <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg ta-modal p-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y - 1)}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-[var(--text-primary)]">
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
                className="mt-2.5 w-full rounded-md bg-[var(--fill-accent)] py-1.5 text-xs font-medium text-[var(--text-on-accent)] hover:bg-[var(--fill-accent-hover)]"
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
        <p style={{ font: "var(--type-body1)", color: "var(--text-tertiary)" }}>
          No entries match the selected filters.
        </p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Type</TH>
              <TH>Leave Type</TH>
              <TH numeric>Change</TH>
              <TH numeric>Balance After</TH>
              <TH>Notes</TH>
              <TH>Date</TH>
              <TH>User</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((entry) => {
              const cfg = TYPE_CONFIG[entry.eventType];
              const isPositive = entry.deltaMinutes >= 0;
              return (
                <TR key={entry.id}>
                  <TD>
                    <Badge tone={cfg.tone} size="sm">
                      {cfg.label}
                    </Badge>
                  </TD>
                  <TD style={{ color: "var(--text-secondary)" }}>{entry.leaveTypeName}</TD>

                  {/* A ledger is read by scanning the change column for the
                      one that does not belong, so sign carries the colour and
                      the figures are tabular. */}
                  <TD numeric style={{ fontWeight: "var(--weight-medium)" }}>
                    {entry.eventType === "eod_balance" ? (
                      <span style={{ color: "var(--text-disabled)" }}>—</span>
                    ) : entry.eventType === "policy_change" ? (
                      <span style={{ color: "var(--wms-color-violet-600)" }}>
                        {fmtBalance(entry.deltaMinutes)}/yr
                      </span>
                    ) : (
                      <span style={{ color: isPositive ? "var(--text-success)" : "var(--text-error)" }}>
                        {fmtMins(entry.deltaMinutes)}
                      </span>
                    )}
                  </TD>

                  <TD numeric>{fmtBalance(entry.balanceAfterMinutes)}</TD>
                  <TD style={{ color: "var(--text-secondary)" }}>
                    {entry.note ?? <span style={{ color: "var(--text-disabled)" }}>—</span>}
                  </TD>
                  <TD
                    numeric
                    align="left"
                    style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}
                  >
                    {fmtDate(entry.timestamp)}
                  </TD>
                  <TD style={{ color: "var(--text-secondary)" }}>{entry.userName}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
