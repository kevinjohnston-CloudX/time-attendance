"use client";

import { useEffect } from "react";

/**
 * The page's side of the gate alert diagnostics (see /api/presence/watch):
 * this page load's id, a running tally of how its checks have gone, and the
 * 30 second report of which building it is on and whether it is in front.
 * Nothing on screen waits for any of it, and a report that fails is dropped.
 */

const BEAT_MS = 30_000;

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One per page load, shared by the reports and the cards. */
export const screenId = randomId();
export const newWatchId = randomId;

/** How the 2 second checks and the alert checks have gone since the last report. */
const tally = {
  pulsesOk: 0,
  pulsesFailed: 0,
  pulseOkAt: null as number | null,
  pulseError: null as string | null,
  alertCheckAt: null as number | null,
  alertCards: null as number | null,
  alertCheckError: null as string | null,
};

export function notePulse(ok: boolean, error?: string): void {
  if (ok) {
    tally.pulsesOk++;
    tally.pulseOkAt = Date.now();
    tally.pulseError = null;
  } else {
    tally.pulsesFailed++;
    tally.pulseError = error ?? "FAILED";
  }
}

export function noteAlertCheck(cards: number | null, error?: string): void {
  if (error) {
    tally.alertCheckError = error;
    return;
  }
  tally.alertCheckAt = Date.now();
  tally.alertCards = cards;
  tally.alertCheckError = null;
}

type Event = Record<string, unknown> & { kind: "beat" | "shown" | "closed" };

/** Sends events without holding anything up; `leaving` lets it outlive the page. */
export function sendWatch(events: Event[], leaving = false): void {
  if (events.length === 0) return;
  try {
    void fetch("/api/presence/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: leaving,
      cache: "no-store",
    }).catch(() => undefined);
  } catch {
    // Diagnostics only.
  }
}

function beat(segmentId: string, siteId: string, visible: boolean): Event {
  const now = Date.now();
  const e: Event = {
    kind: "beat",
    segmentId,
    screenId,
    siteId,
    visible,
    focused: document.hasFocus(),
    deployId: document.documentElement.dataset.dplId ?? null,
    pulsesOk: tally.pulsesOk,
    pulsesFailed: tally.pulsesFailed,
    pulseOkAgoMs: tally.pulseOkAt === null ? null : now - tally.pulseOkAt,
    pulseError: tally.pulseError,
    alertCheckAgoMs: tally.alertCheckAt === null ? null : now - tally.alertCheckAt,
    alertCards: tally.alertCards,
    alertCheckError: tally.alertCheckError,
  };
  tally.pulsesOk = 0;
  tally.pulsesFailed = 0;
  return e;
}

/**
 * Reports which building this page is on every 30 seconds, as one stretch
 * per building and per in front or behind. A change of either closes the old
 * stretch on the spot and opens a new one, and leaving the page closes it.
 */
export function useScreenWatch(siteId: string | null): void {
  useEffect(() => {
    if (!siteId) return;
    let visible = document.visibilityState === "visible";
    let segment = randomId();
    sendWatch([beat(segment, siteId, visible)]);
    const t = window.setInterval(() => sendWatch([beat(segment, siteId, visible)]), BEAT_MS);
    const onVisibility = () => {
      const now = document.visibilityState === "visible";
      if (now === visible) return;
      const last = beat(segment, siteId, visible);
      visible = now;
      segment = randomId();
      sendWatch([last, beat(segment, siteId, visible)]);
    };
    const onLeave = () => sendWatch([beat(segment, siteId, visible)], true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onLeave);
      // Another building, or the page going: this stretch ends now.
      sendWatch([beat(segment, siteId, visible)], true);
    };
  }, [siteId]);
}
