"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import { DataSourcePicker } from "./report-builder/data-source-picker";
import type { DataSourceId } from "@/lib/validators/report.schema";

export interface ReportTypeOption {
  id: DataSourceId;
  label: string;
  description: string;
  icon: string;
  columns?: { id: string; label: string; defaultVisible?: boolean }[];
}

/**
 * The window New report opens: which report to build, before any page.
 *
 * <p>The same window changes the type from inside the builder, where it says
 * that a different type starts the columns and filters over, since that is
 * the one thing picking here throws away. Escape, the X and the scrim all
 * close it without picking anything.
 */
export function ReportTypeDialog({
  sources,
  selected = null,
  changing = false,
  onPick,
  onClose,
}: {
  sources: ReportTypeOption[];
  selected?: DataSourceId | null;
  /** Opened from the builder, over a report already being set up. */
  changing?: boolean;
  onPick: (id: DataSourceId) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Focus comes in on open and goes back to the button that opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(changing ? "[aria-pressed=true]" : "[aria-pressed]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [changing]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-type-title"
        className="ta-modal flex max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-[760px] flex-col overflow-hidden"
        style={{ borderRadius: "var(--radius-l)" }}
      >
        <header className="flex items-start gap-3 px-6 pb-4 pt-5" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="report-type-title" style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
              {changing ? "Change report type" : "New report"}
            </h2>
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              {changing
                ? "A different type starts the columns and filters over. The dates stay."
                : "Pick the report that answers your question. You choose the dates, people and columns next."}
            </span>
          </span>
          <Button hierarchy="tertiary" iconOnly onClick={onClose} aria-label="Close" title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="ta-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5">
          <DataSourcePicker sources={sources} selected={selected} onSelect={onPick} />
        </div>
      </div>
    </div>
  );
}
