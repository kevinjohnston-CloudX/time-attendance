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
 * Cycles system -> light -> dark, as a 28px outlined control in the top bar.
 *
 * <p>Shape taken from the portal design, which puts it beside the other
 * header controls. It used to be a full-width labelled row in the sidebar
 * footer, where it took as much space as a destination without being one.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  // The server has no idea which theme this browser will pick, so rendering
  // the icon before hydration guarantees a mismatch. A fixed-size placeholder
  // keeps the header from shifting when the real control appears.
  if (!hydrated) return <span className="h-7 w-[38px]" aria-hidden />;

  const currentIdx = THEMES.findIndex((t) => t.value === theme);
  const current = THEMES[currentIdx === -1 ? 0 : currentIdx];
  const next = THEMES[(currentIdx + 1) % THEMES.length];

  return (
    <button
      onClick={() => setTheme(next.value)}
      title={`${current.label} theme — switch to ${next.label}`}
      className="ta-outlined inline-flex h-7 items-center gap-1.5 rounded-md px-2"
      style={{
        border: "1px solid var(--stroke-secondary)",
        background: "var(--surface-card)",
        color: "var(--text-secondary)",
      }}
    >
      <current.icon className="h-4 w-4" />
    </button>
  );
}
