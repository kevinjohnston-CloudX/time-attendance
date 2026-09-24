"use client";

import { useState, useRef, useEffect } from "react";
import { Download, FileSpreadsheet, Clock, AlertTriangle, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * The three CSV reports a closed period is usually asked for.
 *
 * <p>A menu rather than three buttons in the header: they are the same action
 * at three levels of detail, and only one of them is ever wanted at a time.
 * The description under each is load-bearing — "Punch Detail" and "Timesheet
 * Summary" are the same hours, and picking the wrong one means a reconciliation
 * against a file that cannot answer the question.
 */

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
    color: "var(--icon-accent)",
  },
  {
    format: "punches",
    icon: Clock,
    title: "Punch Detail",
    description: "Every individual punch with date, time, type, and source",
    color: "var(--icon-secondary)",
  },
  {
    format: "exceptions",
    icon: AlertTriangle,
    title: "Exceptions Report",
    description: "All exceptions — resolved and unresolved — for this period",
    color: "var(--icon-warning)",
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
      {/* A transparent catcher rather than an outside-click listener: the
          trigger sits inside the page header, and a document-level mousedown
          handler would close the menu on the same click that opened it. */}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}

      <div className="relative" ref={ref}>
        <Button
          hierarchy="secondary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          leadingIcon={<Download className="h-4 w-4" />}
        >
          Download reports
        </Button>

        {open && (
          <div
            role="menu"
            aria-label="Pay period reports"
            className="ta-modal absolute right-0 top-full z-50 mt-2 w-80 rounded-xl"
          >
            <div
              className="flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>Reports</span>
                <span style={{ font: "var(--type-subtitle)", color: "var(--text-secondary)" }}>
                  {label}
                </span>
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
            </div>

            <div className="flex flex-col p-2">
              {OPTIONS.map(({ format, icon: Icon, title, description, color }) => (
                <button
                  key={format}
                  type="button"
                  role="menuitem"
                  onClick={() => handleDownload(format)}
                  className="ta-hoverable flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left"
                  style={{ border: "none", background: "transparent", cursor: "pointer" }}
                >
                  <span
                    className="flex flex-none items-center justify-center rounded-lg p-2"
                    style={{ background: "var(--surface-secondary)" }}
                  >
                    <Icon className="h-4 w-4" style={{ color }} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      style={{
                        font: "var(--type-body1)",
                        fontWeight: "var(--weight-medium)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {title}
                    </span>
                    <span
                      style={{
                        font: "var(--type-body2)",
                        color: "var(--text-tertiary)",
                        textWrap: "pretty",
                      }}
                    >
                      {description}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-4 w-4 flex-none"
                    style={{ color: "var(--icon-disabled)" }}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>

            <div className="px-4 py-2.5" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
              <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                All exports are CSV format
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
