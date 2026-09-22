"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A short confirmation that something happened, in the corner, for actions
 * that leave no other mark on the screen.
 *
 * <p>Deliberately not a notification system. It carries one line, it cannot be
 * dismissed into a history, and it never reports a failure: anything a person
 * has to act on belongs beside the control that failed, where they are already
 * looking, not in a corner that disappears after three seconds.
 */
export function useToast(): {
  message: string | null;
  flash: (message: string) => void;
} {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3200);
  }, []);

  // A pending timer holding a setState after the screen has gone is a warning
  // in the console and a leak in a long session.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { message, flash };
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      // Announced rather than shown silently, since the whole point is that
      // nothing else on the screen changed.
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 40,
        maxWidth: "min(24rem, calc(100vw - 40px))",
        padding: "11px 16px",
        borderRadius: 8,
        background: "var(--surface-inverse)",
        color: "var(--ta-text-on-inverse)",
        font: "var(--type-body1)",
        boxShadow: "0 12px 28px rgba(17, 24, 39, 0.22)",
      }}
    >
      {message}
    </div>
  );
}
