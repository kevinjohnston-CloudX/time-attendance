"use client";

import { useState, type ReactNode } from "react";
import { Building2, CircleCheck, FileDown, FileOutput, Hash, Layers } from "lucide-react";
import { Button } from "@/components/ui";
import { PpDialog } from "@/components/payroll/pp-dialog";

/**
 * The ADP export window, from the Pay Periods handoff.
 *
 * <p>Four choices, and then a file leaves the building. The summary at the
 * bottom is the whole reason this is a window rather than a straight
 * download: EPIATW01.csv and EPIGA101.csv are indistinguishable once they are
 * in a downloads folder, and an export of the wrong warehouse's hours is only
 * discovered on the other side of the payroll run.
 */

interface Site {
  id: string;
  name: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "READY", label: "Ready for Lock" },
  { value: "LOCKED", label: "Locked" },
];

const FIELD = "h-9 w-full px-2.5 outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--stroke-accent-focus)] focus-visible:[outline-style:solid]";
const FIELD_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--stroke-default)",
  background: "var(--surface-card)",
  font: "var(--type-body1)",
  color: "var(--text-primary)",
} as const;

/** An uppercase label with a glyph, over its control. */
function Labelled({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="inline-flex items-center gap-1.5"
        style={{ font: "var(--weight-semibold) 11px/14px var(--font-sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "var(--text-tertiary)" }}
      >
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

export function PayPeriodExport({ payPeriodId, label, sites }: { payPeriodId: string; label: string; sites: Site[] }) {
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [status, setStatus] = useState("");
  const [coCode, setCoCode] = useState("ATW");
  const [batchId, setBatchId] = useState("BATCH1");

  function handleDownload() {
    const params = new URLSearchParams();
    if (siteId) params.set("siteId", siteId);
    if (status) params.set("status", status);
    if (coCode) params.set("coCode", coCode);
    if (batchId) params.set("batchId", batchId);
    const a = document.createElement("a");
    a.href = `/api/pay-periods/${payPeriodId}/export/adp?${params.toString()}`;
    a.click();
    setOpen(false);
  }

  const siteName = sites.find((s) => s.id === siteId)?.name ?? "all warehouses";
  const statusWord = STATUS_OPTIONS.find((o) => o.value === status && o.value)?.label.toLowerCase();
  const icon = "h-3.5 w-3.5";

  return (
    <>
      <Button hierarchy="secondary" onClick={() => setOpen(true)} leadingIcon={<FileOutput className="h-4 w-4" />}>
        Export to ADP
      </Button>

      {open && (
        <PpDialog
          icon={<FileOutput className="h-[18px] w-[18px]" aria-hidden />}
          title="Export to ADP"
          subtitle={label}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button hierarchy="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleDownload} disabled={!coCode || !batchId} leadingIcon={<FileDown className="h-4 w-4" />}>
                Download CSV
              </Button>
            </>
          }
        >
          <Labelled label="Warehouse" icon={<Building2 className={icon} aria-hidden />}>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={FIELD} style={FIELD_STYLE}>
              <option value="">All Warehouses</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Status" icon={<CircleCheck className={icon} aria-hidden />}>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={FIELD} style={FIELD_STYLE}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Labelled>
          {/* Both are ADP's own identifiers, upper-cased on the way in because
              the file ADP parses is case-sensitive and nothing on this screen
              can tell the clerk that they typed it lowercase. */}
          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Co Code" icon={<Hash className={icon} aria-hidden />}>
              <input value={coCode} maxLength={10} onChange={(e) => setCoCode(e.target.value.toUpperCase())} className={FIELD} style={FIELD_STYLE} />
            </Labelled>
            <Labelled label="Batch ID" icon={<Layers className={icon} aria-hidden />}>
              <input value={batchId} maxLength={20} onChange={(e) => setBatchId(e.target.value.toUpperCase())} className={FIELD} style={FIELD_STYLE} />
            </Labelled>
          </div>
          <div className="flex flex-col gap-0.5 px-3 py-2.5" style={{ borderRadius: 10, background: "var(--ta-well)", font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            <span>
              Exports {statusWord ? `${statusWord} ` : ""}timesheets for {siteName} as an ADP file, company code {coCode || "not set"}, batch {batchId || "not set"}.
            </span>
            <span style={{ color: "var(--text-tertiary)" }}>
              File name: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>EPI{coCode || "???"}01.csv</span>
            </span>
          </div>
        </PpDialog>
      )}
    </>
  );
}
