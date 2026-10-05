"use client";

import { Bell, BellOff, ChevronRight, Tablet as TabletIcon } from "lucide-react";
import type { BuildingTablets } from "@/lib/presence/tablets.service";
import { countHealth } from "./tablet-health";
import styles from "./building-windows.module.css";

/**
 * Two status chips beside "Live, updated just now" under the Live Attendance
 * title: how this building's tablets are doing, and whether its gate alerts
 * are on. Each says it in words and opens its window, so nobody has to guess
 * what an icon means; they sit with the page's other live status rather than
 * among the controls that change the view.
 */
export function TabletsChip({ data, onOpen }: { data: BuildingTablets | null; onOpen: () => void }) {
  let tone: "ok" | "bad" | "quiet" = "quiet";
  let text = "Tablets";
  if (data) {
    const n = data.tablets.length;
    const c = countHealth(data.tablets);
    if (n === 0) text = "No tablets";
    else if (c.ATTENTION > 0) {
      tone = "bad";
      text = `${n} ${n === 1 ? "tablet" : "tablets"}, ${c.ATTENTION} ${c.ATTENTION === 1 ? "needs" : "need"} attention`;
    } else if (c.WORKING === n) {
      tone = "ok";
      text = `${n} ${n === 1 ? "tablet" : "tablets"}, all working`;
    } else if (c.WORKING > 0) {
      tone = "ok";
      text = `${n} tablets, ${c.WORKING} working`;
    } else text = `${n} ${n === 1 ? "tablet" : "tablets"}, waiting for the app update`;
  }
  return (
    <button type="button" className={styles.chip} onClick={onOpen} title="See this building's tablets">
      <TabletIcon aria-hidden="true" />
      <span className={styles.chipDot} data-tone={tone} aria-hidden="true" />
      <span className={styles.chipText}>{text}</span>
      <ChevronRight className={styles.chipChev} aria-hidden="true" />
    </button>
  );
}

export function GateAlertsChip({ on, onOpen }: { on: boolean; onOpen: () => void }) {
  const Icon = on ? Bell : BellOff;
  return (
    <button type="button" className={styles.chip} onClick={onOpen} title="Turn gate alerts on or off for each building">
      <Icon aria-hidden="true" />
      <span className={styles.chipDot} data-tone={on ? "ok" : "quiet"} aria-hidden="true" />
      <span className={styles.chipText}>{on ? "Gate alerts on" : "Gate alerts off"}</span>
      <ChevronRight className={styles.chipChev} aria-hidden="true" />
    </button>
  );
}
