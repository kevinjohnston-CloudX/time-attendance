"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { OctagonAlert, TriangleAlert, X } from "lucide-react";
import { Button } from "./button";

/**
 * The design system's ConfirmDialog: a small centred card with the icon, a
 * question for a title, one sentence saying what will happen, and Cancel
 * beside the action.
 *
 * <p>For a yes or no before something that cannot be taken back. Anything
 * with fields in it is a SetupDialog instead. Escape, the X, Cancel and the
 * scrim all close it, except while the action is running, so a slow request
 * cannot be abandoned halfway and clicked again.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  pendingLabel,
  tone = "danger",
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** What the action button says while it runs ("Revoking…"). */
  pendingLabel?: string;
  tone?: "danger" | "warning";
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  const pendingRef = useRef(pending);
  useEffect(() => {
    cancelRef.current = onCancel;
    pendingRef.current = pending;
  }, [onCancel, pending]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // Cancel, not the action: an Enter pressed out of habit must not revoke.
    ref.current?.querySelector<HTMLElement>("[data-cancel]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!pendingRef.current) cancelRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  const Icon = tone === "danger" ? OctagonAlert : TriangleAlert;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: "var(--wms-overlay-modal)" }}
      onClick={(e) => e.target === e.currentTarget && !pending && onCancel()}
    >
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative flex w-full max-w-[470px] flex-col items-center gap-3.5 px-6 pb-5 pt-4 text-center sm:w-auto sm:min-w-[370px]"
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--stroke-divider)",
          borderRadius: "var(--radius-l)",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <span className="absolute right-3.5 top-3.5">
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onCancel} disabled={pending} aria-label="Close">
            <X className="h-[18px] w-[18px]" style={{ color: "var(--icon-tertiary)" }} />
          </Button>
        </span>
        <Icon
          className="h-12 w-12"
          strokeWidth={1.3}
          aria-hidden
          style={{ color: tone === "danger" ? "var(--icon-error)" : "var(--icon-warning)" }}
        />
        <div className="flex flex-col items-center">
          <h3
            id="confirm-dialog-title"
            style={{ margin: 0, font: "var(--weight-semibold) 18px/26px var(--font-sans)", color: "var(--text-primary)" }}
          >
            {title}
          </h3>
          <div style={{ maxWidth: 340, font: "var(--type-body1)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            {children}
          </div>
        </div>
        {error && (
          <p role="alert" style={{ margin: 0, maxWidth: 340, font: "var(--type-body2)", color: "var(--text-error)" }}>
            {error}
          </p>
        )}
        <div className="flex w-full justify-center gap-2">
          <Button data-cancel hierarchy="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            tone={tone === "danger" ? "error" : "warning"}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
