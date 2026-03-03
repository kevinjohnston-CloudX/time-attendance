"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";

const THEMES = [
  { value: "system", icon: Monitor, label: "System" },
  { value: "light",  icon: Sun,     label: "Light"  },
  { value: "dark",   icon: Moon,    label: "Dark"   },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch — render nothing until client knows the theme
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const currentIdx = THEMES.findIndex((t) => t.value === theme);
  const current = THEMES[currentIdx === -1 ? 0 : currentIdx];
  const next = THEMES[(currentIdx + 1) % THEMES.length];

  return (
    <button
      onClick={() => setTheme(next.value)}
      title={`Switch to ${next.label} mode`}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
    >
      <current.icon className="h-4 w-4 shrink-0" />
      {current.label}
    </button>
  );
}
