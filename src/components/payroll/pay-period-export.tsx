"use client";

import { useState, useEffect } from "react";
import { X, FileDown, Building2, CheckCircle } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";

/**
 * The ADP export dialog.
 *
 * <p>Four choices, and then a file leaves the building. The preview line at
 * the bottom is the whole reason this is a dialog rather than a straight
 * download: EPIATW01.csv and EPIGA101.csv are indistinguishable once they are
 * in a downloads folder, and an export of the wrong warehouse's hours is only
 * discovered on the other side of the payroll run.
 */

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

/** An uppercase label with a glyph, over its control. */
function Labelled({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="wms-overline inline-flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

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
      <Button
        hierarchy="secondary"
        onClick={() => setOpen(true)}
        leadingIcon={<FileDown className="h-4 w-4" />}
      >
        Export
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 backdrop-blur-sm"
            style={{ background: "rgb(0 0 0 / 0.4)" }}
            onClick={() => setOpen(false)}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="adp-export-title"
            className="ta-modal relative z-10 w-full max-w-md rounded-2xl"
          >
            <header
              className="flex items-start justify-between gap-3 px-6 py-4"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex flex-col gap-0.5">
                <h2
                  id="adp-export-title"
                  style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}
                >
                  Export to ADP
                </h2>
                <p style={{ margin: 0, font: "var(--type-subtitle)", color: "var(--text-secondary)" }}>
                  {label}
                </p>
              </div>
              <Button
                hierarchy="tertiary"
                size="sm"
                iconOnly
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </header>

            <div className="flex flex-col gap-4 px-6 py-5">
              <Labelled label="Warehouse" icon={<Building2 className="h-3.5 w-3.5" />}>
                <Select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="">All Warehouses</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </Labelled>

              <Labelled label="Status" icon={<CheckCircle className="h-3.5 w-3.5" />}>
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Labelled>

              {/* Both are ADP's own identifiers, upper-cased on the way in
                  because the file ADP parses is case-sensitive and nothing on
                  this screen can tell the clerk that they typed it lowercase. */}
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Co Code"
                  value={coCode}
                  onChange={(e) => setCoCode(e.target.value.toUpperCase())}
                  maxLength={10}
                />
                <Input
                  label="Batch ID"
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value.toUpperCase())}
                  maxLength={20}
                />
              </div>

              <div
                className="flex flex-col gap-0.5 rounded-lg px-4 py-3"
                style={{
                  border: "1px solid var(--stroke-divider)",
                  background: "var(--surface-secondary)",
                }}
              >
                <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                  File preview:{" "}
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    EPI{coCode || "???"}01.csv
                  </span>
                </span>
                <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                  {siteName} · {statusLabel} timesheets
                </span>
              </div>
            </div>

            <footer
              className="flex items-center justify-end gap-3 px-6 py-4"
              style={{ borderTop: "1px solid var(--stroke-divider)" }}
            >
              <Button hierarchy="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleDownload}
                disabled={!coCode || !batchId}
                leadingIcon={<FileDown className="h-4 w-4" />}
              >
                Download CSV
              </Button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
