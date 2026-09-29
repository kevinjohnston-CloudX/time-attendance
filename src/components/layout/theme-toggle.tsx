"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";

const THEMES = [
  { value: "system", icon: Monitor, label: "System" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
] as const;

/**
 * True once this is running in the browser, false while rendering on the
 * server and during hydration.
 *
 * <p>Nothing to subscribe to — the answer only ever changes once, and
 * useSyncExternalStore is what turns "the server and the client see different
 * things" into a supported re-render rather than a setState inside an effect.
 */
const noSubscribe = () => () => {};
const useHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false);

/**
 * Cycles system -> light -> dark, as a round 28px button in the top bar's
 * icon pill, from the Layout handoff.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  // The server has no idea which theme this browser will pick, so rendering
  // the icon before hydration guarantees a mismatch. A fixed-size placeholder
  // keeps the header from shifting when the real control appears.
  if (!hydrated) return <span className="h-7 w-7 flex-none" aria-hidden />;

  const currentIdx = THEMES.findIndex((t) => t.value === theme);
  const current = THEMES[currentIdx === -1 ? 0 : currentIdx];
  const next = THEMES[(currentIdx + 1) % THEMES.length];

  return (
    <button
      onClick={() => setTheme(next.value)}
      type="button"
      title={`${current.label} theme. Switch to ${next.label}`}
      aria-label={`${current.label} theme. Switch to ${next.label}`}
      className="ta-pill-btn grid h-7 w-7 flex-none place-items-center rounded-full"
      style={{ color: "var(--icon-tertiary)" }}
    >
      <current.icon className="h-4 w-4" />
    </button>
  );
}
