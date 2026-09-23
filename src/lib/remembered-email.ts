"use client";

import { useSyncExternalStore } from "react";

const KEY = "ta.signin.email";

/**
 * The email "Remember me" keeps on this browser, so the sign-in page can fill
 * it in next time. Only ever the address, never the password: that stays with
 * the browser's own password manager, which is built to hold one.
 *
 * <p>Read through useSyncExternalStore, like the sidebar's choices, because
 * the server cannot know what this browser stored. The first render is empty
 * and the address arrives straight after.
 */
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export const rememberedEmailStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
  get(): string {
    try {
      return window.localStorage.getItem(KEY) ?? "";
    } catch {
      return ""; // private window, blocked storage
    }
  },
  getServer(): string {
    return "";
  },
  save(email: string) {
    try {
      window.localStorage.setItem(KEY, email);
    } catch {
      /* the sign-in still worked, so nothing to report */
    }
    notify();
  },
  forget() {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* nothing stored to remove */
    }
    notify();
  },
};

export function useRememberedEmail(): string {
  return useSyncExternalStore(rememberedEmailStore.subscribe, rememberedEmailStore.get, rememberedEmailStore.getServer);
}
