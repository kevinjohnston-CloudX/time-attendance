"use client";

import { Sparkles } from "lucide-react";
import { switchHref } from "@/lib/design-switch";

/**
 * The classic design's way to the new one, in the sidebar's foot beside the
 * theme button, drawn like it. It saves New for this person and reloads the
 * page they are on in the new design (same address). A full load on purpose:
 * each design has its own styles, and one's must not linger on the other's
 * pages. The new design's top bar has the way back.
 *
 * <p>When Classic has a last day, it says so under the button.
 */
export function NewDesignButton({ iconOnly = false, classicUntil = null }: { iconOnly?: boolean; classicUntil?: string | null }) {
  function open() {
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.assign(switchHref("new", here, { viaSwitch: true }));
  }

  if (iconOnly) {
    return (
      <button
        onClick={open}
        title="Switch to the new design"
        className="rounded-lg p-2 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/40"
      >
        <Sparkles className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={open}
        title="Switch to the new design"
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/40"
      >
        <Sparkles className="h-4 w-4 shrink-0" />
        Switch to new design
      </button>
      {classicUntil && (
        <p className="px-3 pb-1 text-xs text-zinc-500 dark:text-zinc-400">Classic design ends {classicUntil}.</p>
      )}
    </div>
  );
}
