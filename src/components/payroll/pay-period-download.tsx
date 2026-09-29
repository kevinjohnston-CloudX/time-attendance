"use client";

import { useState, useRef, useEffect } from "react";
import { Download, FileSpreadsheet, Clock, AlertTriangle } from "lucide-react";
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
  label: string; // e.g. "Jul 1 to Jul 14, 2026"
}

const OPTIONS = [
  {
    format: "summary",
    icon: FileSpreadsheet,
    title: "Timesheet Summary",
    description: "One row per employee: REG, OT and DT hour totals",
    color: "var(--icon-accent)",
  },
  {
    format: "punches",
    icon: Clock,
    title: "Punch Detail",
    description: "Every individual punch with date, time, type and source",
    color: "var(--icon-secondary)",
  },
  {
    format: "exceptions",
    icon: AlertTriangle,
    title: "Exceptions Report",
    description: "All exceptions, resolved and unresolved, for this period",
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
          Reports
        </Button>

        {open && (
          <div
            role="menu"
            aria-label={`Reports for ${label}`}
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-80 p-1.5"
            style={{ borderRadius: 12, background: "var(--surface-card)", boxShadow: "var(--ta-menu-shadow)" }}
          >
            {OPTIONS.map(({ format, icon: Icon, title, description, color }) => (
              <button
                key={format}
                type="button"
                role="menuitem"
                onClick={() => handleDownload(format)}
                className="ta-hoverable flex w-full items-start gap-2.5 p-2.5 text-left"
                style={{ border: "none", borderRadius: 10, background: "transparent", cursor: "pointer" }}
              >
                <span
                  className="grid h-8 w-8 flex-none place-items-center"
                  style={{ borderRadius: 9, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)" }}
                >
                  <Icon className="h-4 w-4" style={{ color }} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span style={{ font: "var(--weight-medium) 13px/18px var(--font-sans)", color: "var(--text-primary)" }}>{title}</span>
                  <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" }}>{description}</span>
                </span>
                <Download className="mt-2 h-4 w-4 flex-none" style={{ color: "var(--icon-disabled)" }} aria-hidden />
              </button>
            ))}
            <p className="m-0 px-2.5 pb-1.5 pt-1" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
              Every report downloads as a CSV file.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
