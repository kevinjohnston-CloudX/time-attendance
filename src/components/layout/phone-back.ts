"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The back button in the phone's top bar.
 *
 * <p>A screen that opens one thing from a list on the same page (a person's
 * exceptions, a timecard, a settings area) says so here, and the top bar
 * shows a chevron with the list's name where the logo was, as a phone app
 * does, instead of a "Back" link inside the page. The screen's own link
 * stays for computers.
 */

export type PhoneBack = { label: string; onBack: () => void };

let current: PhoneBack | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function usePhoneBackState(): PhoneBack | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}

/** Show a back button for as long as `label` is set. */
export function usePhoneBack(label: string | null, onBack: () => void) {
  const ref = useRef(onBack);
  useEffect(() => {
    ref.current = onBack;
  });
  useEffect(() => {
    if (!label) return;
    const mine: PhoneBack = { label, onBack: () => ref.current() };
    current = mine;
    emit();
    return () => {
      if (current === mine) {
        current = null;
        emit();
      }
    };
  }, [label]);
}
