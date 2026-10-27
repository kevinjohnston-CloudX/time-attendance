"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LifeBuoy } from "lucide-react";

/**
 * The Help & feedback button, in the shape each place draws it: a round button
 * in the top bar's icon pill, a finger-sized one in the phone's top bar, and a
 * row (or, folded, an icon) at the foot of the Classic sidebar.
 *
 * <p>The window and its editor load the first time it is opened, so no page
 * pays for them up front.
 */
const HelpWindow = dynamic(() => import("./help-window").then((m) => m.HelpWindow), { ssr: false });

export function HelpButton({
  variant,
  className,
}: {
  variant: "pill" | "phone" | "classic" | "classicIcon";
  /** The phone bar's own button class, so it matches its neighbours. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = "Help & feedback";

  const button =
    variant === "pill" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        className="ta-pill-btn grid h-7 w-7 flex-none place-items-center rounded-full"
        style={{ color: "var(--icon-tertiary)" }}
      >
        <LifeBuoy className="h-4 w-4" />
      </button>
    ) : variant === "phone" ? (
      <button type="button" onClick={() => setOpen(true)} aria-label={label} aria-haspopup="dialog" className={className}>
        <LifeBuoy className="h-5 w-5" aria-hidden="true" />
      </button>
    ) : variant === "classicIcon" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
      >
        <LifeBuoy className="h-4 w-4" />
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
      >
        <LifeBuoy className="h-4 w-4 shrink-0" />
        {label}
      </button>
    );

  return (
    <>
      {button}
      {open && <HelpWindow onClose={() => setOpen(false)} />}
    </>
  );
}
