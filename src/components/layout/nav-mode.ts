"use client";

import { useSyncExternalStore } from "react";

const NAV_MODE_KEY = "ta.sidebar.nav";

/** The two navigation layouts the design offers. */
export type NavMode = "grouped" | "rail";

/**
 * Grouped or Rail, kept in localStorage beside the sidebar's collapse choice.
 *
 * <p>In its own module because two parts of the shell need it: the top bar
 * draws the switch, where the design puts it, and the sidebar draws whichever
 * layout it selects. Importing one of those from the other to reach the store
 * would pull the whole sidebar into the header.
 *
 * <p>Read through useSyncExternalStore rather than copied into state on mount.
 * The server cannot know what this browser stored, so the first render has to
 * say "grouped" and the truth has to arrive afterwards. The "storage" event
 * covers the same account open in a second tab.
 */
export const navModeStore = {
  listeners: new Set<() => void>(),
  subscribe(cb: () => void) {
    navModeStore.listeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      navModeStore.listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
  get(): NavMode {
    try {
      return window.localStorage.getItem(NAV_MODE_KEY) === "rail" ? "rail" : "grouped";
    } catch {
      return "grouped"; // private window, blocked storage
    }
  },
  /** What the server renders. It has no browser to ask. */
  getServer(): NavMode {
    return "grouped";
  },
  set(next: NavMode) {
    try {
      window.localStorage.setItem(NAV_MODE_KEY, next);
    } catch {
      /* not worth failing the click over */
    }
    navModeStore.listeners.forEach((l) => l());
  },
};

export function useNavMode(): NavMode {
  return useSyncExternalStore(navModeStore.subscribe, navModeStore.get, navModeStore.getServer);
}
