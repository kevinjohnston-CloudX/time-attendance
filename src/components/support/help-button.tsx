"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LifeBuoy } from "lucide-react";

/**
 * The Help & feedback button, in the shape each place draws it: a round button
 * in the top bar's icon pill, and a finger-sized one in the phone's top bar.
 *
 *
 * <p>The window and its editor load the first time it is opened, so no page
 * pays for them up front.
 */
const HelpWindow = dynamic(() => import("./help-window").then((m) => m.HelpWindow), { ssr: false });

export function HelpButton({
  variant,
  className,
}: {
  variant: "pill" | "phone";
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
    ) : (
      <button type="button" onClick={() => setOpen(true)} aria-label={label} aria-haspopup="dialog" className={className}>
        <LifeBuoy className="h-5 w-5" aria-hidden="true" />
      </button>
    );

  return (
    <>
      {button}
      {open && <HelpWindow onClose={() => setOpen(false)} />}
    </>
  );
}
