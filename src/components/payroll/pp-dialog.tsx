"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * The Pay Periods handoff's form window (Export to ADP, Reopen): an icon
 * tile, the title with the period under it, the fields, then Cancel and the
 * action on a divided foot. Escape, the X, Cancel and the scrim close it,
 * except while the action runs.
 */
export function PpDialog({
  icon,
  title,
  subtitle,
  width = 440,
  pending = false,
  onClose,
  footer,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  width?: number;
  pending?: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const pendingRef = useRef(pending);
  useEffect(() => {
    closeRef.current = onClose;
    pendingRef.current = pending;
  }, [onClose, pending]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("select, input, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!pendingRef.current) closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[58] flex items-start justify-center px-4 pb-4 pt-[14vh]">
      <div className="absolute inset-0" style={{ background: "var(--wms-overlay-modal)" }} onClick={() => !pending && onClose()} />
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pp-dialog-title"
        className="ta-modal relative max-w-full"
        style={{ width, borderRadius: 18 }}
      >
        <div className="flex items-start gap-3 pb-3.5 pl-[22px] pr-[18px] pt-5">
          <span
            className="grid h-[38px] w-[38px] flex-none place-items-center"
            style={{ borderRadius: 11, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", color: "var(--icon-tertiary)" }}
          >
            {icon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id="pp-dialog-title" className="m-0" style={{ font: "var(--weight-semibold) 16px/22px var(--font-sans)", color: "var(--text-primary)" }}>
              {title}
            </h2>
            <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              {subtitle}
            </span>
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly aria-label="Close" onClick={onClose} disabled={pending}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3.5 px-[22px] pb-[18px] pt-1">{children}</div>
        <div className="flex justify-end gap-2 px-[18px] pb-4 pt-3" style={{ boxShadow: "inset 0 1px 0 var(--ta-well-ring)" }}>
          {footer}
        </div>
      </section>
    </div>
  );
}
