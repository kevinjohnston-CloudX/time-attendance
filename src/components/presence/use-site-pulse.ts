"use client";

import { useEffect, useRef, useState } from "react";
import { notePulse } from "./screen-watch";

/**
 * How often an open Live Attendance page asks whether anything happened at
 * its building. A scan reaches CloudTime a second or two after the badge, so
 * this puts it on screen within a few seconds; the answer is two times, and
 * a quiet building costs one small query per ask (see /api/presence/pulse).
 */
const PULSE_MS = 2_000;

export interface SitePulse {
  scans: string | null;
  refusals: string | null;
}

/**
 * The building's latest pulse, asked every {@link PULSE_MS} while the tab is
 * visible and not at all while it is hidden. Null until the first answer, and
 * again straight after the building changes, so an answer for the previous
 * one is never read as news about this one.
 */
export function useSitePulse(siteId: string | null, alerts: boolean): SitePulse | null {
  const [pulse, setPulse] = useState<{ siteId: string; value: SitePulse } | null>(null);

  useEffect(() => {
    if (!siteId) return;
    let stopped = false;
    let inFlight = false;
    const controller = new AbortController();
    const ask = async () => {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const res = await fetch(`/api/presence/pulse?site=${encodeURIComponent(siteId)}${alerts ? "&alerts=1" : ""}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (stopped) return;
        if (!res.ok) {
          notePulse(false, `HTTP ${res.status}`);
          return;
        }
        const value = (await res.json()) as SitePulse;
        if (stopped) return;
        notePulse(true);
        setPulse((p) =>
          p && p.siteId === siteId && p.value.scans === value.scans && p.value.refusals === value.refusals
            ? p
            : { siteId, value },
        );
      } catch {
        // A missed ask is made up by the next one, and the views keep their
        // own slower refresh underneath.
        if (!stopped) notePulse(false, "UNREACHABLE");
      } finally {
        inFlight = false;
      }
    };
    void ask();
    const id = window.setInterval(() => void ask(), PULSE_MS);
    const onVisibility = () => void ask();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [siteId, alerts]);

  return pulse && pulse.siteId === siteId ? pulse.value : null;
}

/**
 * Runs `onChange` each time `value` moves on from one it has already seen.
 * The first value only sets the baseline, since whatever it describes was
 * loaded along with the view; so does the first one after `enabled` turns on.
 *
 * <p>With `minGapMs`, runs at most once per gap: a change inside the gap is
 * held and run once when the gap ends, however many arrived, so the last one
 * always lands. For the whole-building reloads (the board, Movements), which a
 * busy gate would otherwise ask for every few seconds on every screen.
 */
export function useOnPulseChange(
  value: string | null | undefined,
  enabled: boolean,
  onChange: () => void,
  minGapMs = 0,
): void {
  const seen = useRef<{ value: string | null } | null>(null);
  const latest = useRef(onChange);
  const lastRun = useRef(0);
  const held = useRef<number | null>(null);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!enabled || value === undefined) {
      seen.current = null;
      return;
    }
    if (seen.current === null) {
      seen.current = { value };
      return;
    }
    if (seen.current.value === value) return;
    seen.current = { value };
    if (held.current !== null) return;
    const wait = lastRun.current + minGapMs - Date.now();
    if (wait <= 0) {
      lastRun.current = Date.now();
      latest.current();
      return;
    }
    held.current = window.setTimeout(() => {
      held.current = null;
      lastRun.current = Date.now();
      latest.current();
    }, wait);
  }, [value, enabled, minGapMs]);
  // A held run belongs to the view that asked for it: turning the view off
  // or leaving the page drops it, and the view's own load takes over.
  useEffect(
    () => () => {
      if (held.current !== null) window.clearTimeout(held.current);
      held.current = null;
    },
    [enabled],
  );
}
