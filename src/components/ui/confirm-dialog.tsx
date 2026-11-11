"use client";

import { useEffect, useId, type ReactNode } from "react";
import { Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { Button } from "./button";
import { Window, WindowCard } from "./window";
import styles from "./confirm-dialog.module.css";

/**
 * A yes or no before something that cannot be taken back, on the same frame
 * as every other window: the tone in the glyph, the question as the title,
 * what will happen in one white card, and the buttons on the right with one
 * quiet line beside them (the error when there is one, else the hint).
 *
 * <p>Anything with more than a field or two is a window of its own instead.
 * Escape, the X, Cancel and the scrim all close it, except while the action is
 * running, so a slow request cannot be abandoned halfway and clicked again.
 * Focus starts on Cancel, so an Enter pressed out of habit never confirms.
 */
export function ConfirmDialog({
  title,
  subtitle,
  children,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  hint,
  tone = "danger",
  pending = false,
  confirmDisabled = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** What it acts on, under the question: a key, a webhook, a person. */
  subtitle?: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  /** What the action button says while it runs ("Revoking…"). */
  pendingLabel?: string;
  /** The way out, when "Cancel" would read as the action itself ("Keep request"). */
  cancelLabel?: string;
  /** One quiet line beside the buttons, such as "This cannot be undone." */
  hint?: ReactNode;
  /** danger (red) for what takes access or data away, warning (amber) for
   *  what cannot be undone quietly, info (blue) for a routine step. */
  tone?: "danger" | "warning" | "info";
  pending?: boolean;
  /** Holds the action back until something in the body is filled in, such as a required reason. */
  confirmDisabled?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelId = useId();

  // After the window has taken focus for itself (its effect runs first).
  useEffect(() => {
    document.getElementById(cancelId)?.focus({ preventScroll: true });
  }, [cancelId]);

  const Icon = tone === "danger" ? OctagonAlert : tone === "warning" ? TriangleAlert : Info;

  return (
    <Window
      alert
      size="sm"
      tone={tone === "info" ? "accent" : tone}
      icon={<Icon />}
      title={title}
      subtitle={subtitle}
      busy={pending}
      foot={error ?? hint}
      footTone={error ? "error" : undefined}
      onClose={onCancel}
      actions={
        <>
          <Button id={cancelId} hierarchy="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            tone={tone === "danger" ? "error" : tone === "warning" ? "warning" : "regular"}
            onClick={onConfirm}
            pending={pending}
            disabled={pending || confirmDisabled}
          >
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </>
      }
    >
      <WindowCard padded>
        <div className={styles.body}>{children}</div>
      </WindowCard>
    </Window>
  );
}
