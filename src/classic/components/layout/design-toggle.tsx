"use client";

import { switchHref } from "@/lib/design-switch";

/**
 * The classic design's design switch, in the same place as the new design's:
 * the right end of a slim bar across the top of the page. The same small caps
 * "Design" label and the same Classic and New choices, at the new control's
 * size (a 24px track with 20px segments), drawn in the classic palette since
 * the new design's styles never load here.
 *
 * <p>Picking New saves it for this person and reloads the page they are on in
 * the new design, at the same address. A full load on purpose: each design
 * has its own styles, and one's must not linger on the other's pages.
 *
 * <p>When Classic has a last day, it says so beside the switch.
 */
export function ClassicDesignSwitch({ classicUntil = null }: { classicUntil?: string | null }) {
  function openNew() {
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.assign(switchHref("new", here, { viaSwitch: true }));
  }

  return (
    <div className="flex flex-none items-center gap-2.5">
      {classicUntil && (
        <span className="hidden whitespace-nowrap text-xs font-medium text-amber-700 sm:inline dark:text-amber-400">
          Classic design ends {classicUntil}
        </span>
      )}
      <span className="hidden whitespace-nowrap text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-zinc-400 lg:inline dark:text-zinc-500">
        Design
      </span>
      <div
        role="radiogroup"
        aria-label="Design"
        className="inline-flex h-6 flex-none items-center rounded-md bg-zinc-200/70 p-0.5 dark:bg-zinc-800"
      >
        <button
          type="button"
          role="radio"
          aria-checked="true"
          className="h-5 whitespace-nowrap rounded bg-white px-2.5 text-xs font-semibold leading-4 text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white"
        >
          Classic
        </button>
        <button
          type="button"
          role="radio"
          aria-checked="false"
          onClick={openNew}
          title="Switch to the new design"
          className="h-5 whitespace-nowrap rounded px-2.5 text-xs font-medium leading-4 text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-400 dark:hover:text-white"
        >
          New
        </button>
      </div>
    </div>
  );
}
