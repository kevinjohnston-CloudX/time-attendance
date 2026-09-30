"use client";

import { useState, useRef, useEffect } from "react";
import { Download, FileSpreadsheet, Clock, AlertTriangle, X, ChevronRight } from "lucide-react";

interface Props {
  payPeriodId: string;
  label: string; // e.g. "Jul 1 – Jul 14, 2026"
}

const OPTIONS = [
  {
    format: "summary",
    icon: FileSpreadsheet,
    title: "Timesheet Summary",
    description: "One row per employee — REG, OT, and DT hours totals",
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
  },
  {
    format: "punches",
    icon: Clock,
    title: "Punch Detail",
    description: "Every individual punch with date, time, type, and source",
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/30",
  },
  {
    format: "exceptions",
    icon: AlertTriangle,
    title: "Exceptions Report",
    description: "All exceptions — resolved and unresolved — for this period",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
  },
] as const;

export function PayPeriodDownload({ payPeriodId, label }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function handleDownload(fmt: string) {
    const url = `/api/pay-periods/${payPeriodId}/export?format=${fmt}`;
    const a = document.createElement("a");
    a.href = url;
    a.click();
    setOpen(false);
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          <Download className="h-4 w-4" />
          Reports
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">Reports</p>
                <p className="text-xs text-zinc-500">{label}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Options */}
            <div className="p-2">
              {OPTIONS.map(({ format, icon: Icon, title, description, color, bg }) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => handleDownload(format)}
                  className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <div className={`shrink-0 rounded-lg p-2 ${bg}`}>
                    <Icon className={`h-4 w-4 ${color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">{title}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
                </button>
              ))}
            </div>

            <div className="border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
              <p className="text-xs text-zinc-400">All exports are CSV format</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
