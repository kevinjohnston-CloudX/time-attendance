"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Window, WindowCard } from "@/components/ui/window";

/**
 * A pay period form window (Reopen, Unlock timecard, a filter), on the shared
 * window frame: the glyph, the title with the period or person under it, the
 * fields in one white card, then Cancel and the action on the right. Escape,
 * the X, Cancel and the scrim close it, except while the action runs.
 */
export function PpDialog({
  icon,
  title,
  subtitle,
  width = 440,
  pending = false,
  hint,
  onClose,
  footer,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  width?: number;
  pending?: boolean;
  /** One quiet line on the left of the buttons. */
  hint?: ReactNode;
  onClose: () => void;
  /** The buttons. */
  footer: ReactNode;
  children: ReactNode;
}) {
  const fieldsRef = useRef<HTMLDivElement>(null);

  // The first field, once the window has taken focus for itself.
  useEffect(() => {
    fieldsRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus();
  }, []);

  return (
    <Window icon={icon} title={title} subtitle={subtitle} width={width} busy={pending} foot={hint} onClose={onClose} actions={footer}>
      <WindowCard padded>
        <div ref={fieldsRef} className="flex flex-col gap-3.5">
          {children}
        </div>
      </WindowCard>
    </Window>
  );
}
