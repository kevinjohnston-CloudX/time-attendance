"use client";

import { useState, useEffect } from "react";
import { X, FileDown, Building2, CheckCircle } from "lucide-react";

interface Site {
  id: string;
  name: string;
}

interface Props {
  payPeriodId: string;
  label: string;
  sites: Site[];
}

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "READY", label: "Ready" },
  { value: "LOCKED", label: "Locked" },
];

export function PayPeriodExport({ payPeriodId, label, sites }: Props) {
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [status, setStatus] = useState("");
  const [coCode, setCoCode] = useState("ATW");
  const [batchId, setBatchId] = useState("BATCH1");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function handleDownload() {
    const params = new URLSearchParams();
    if (siteId)  params.set("siteId",  siteId);
    if (status)  params.set("status",  status);
    if (coCode)  params.set("coCode",  coCode);
    if (batchId) params.set("batchId", batchId);
    const a = document.createElement("a");
    a.href = `/api/pay-periods/${payPeriodId}/export/adp?${params.toString()}`;
    a.click();
    setOpen(false);
  }

  const siteName = sites.find((s) => s.id === siteId)?.name ?? "All Warehouses";
  const statusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? "All";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      >
        <FileDown className="h-4 w-4" />
        Export
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Export to ADP</h2>
                <p className="mt-0.5 text-sm text-zinc-500">{label}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Filters */}
            <div className="space-y-4 px-6 py-5">
              {/* Warehouse */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <Building2 className="h-3.5 w-3.5" />
                  Warehouse
                </label>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="">All Warehouses</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* ADP Config */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Co Code
                  </label>
                  <input
                    type="text"
                    value={coCode}
                    onChange={(e) => setCoCode(e.target.value.toUpperCase())}
                    maxLength={10}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Batch ID
                  </label>
                  <input
                    type="text"
                    value={batchId}
                    onChange={(e) => setBatchId(e.target.value.toUpperCase())}
                    maxLength={20}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                <p className="text-xs text-zinc-500">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">File preview: </span>
                  EPI{coCode || "???"}01.csv
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {siteName} · {statusLabel} timesheets
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!coCode || !batchId}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileDown className="h-4 w-4" />
                Download CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
