"use client";

import { useId } from "react";
import { TriangleAlert, X } from "lucide-react";
import { switchHref, type SwitchSpot } from "@/lib/design-switch";
import { useDesignNotice } from "@/components/layout/use-design-notice";

/**
 * The classic design's design switch, drawn on exactly the spot the new
 * design's sits (measured there, see SWITCH_SPOT_COOKIE), at exactly its
 * size, so nothing moves when somebody flips between the designs.
 *
 * <p>Its geometry is the new control's, number for number: the new design's
 * font (Inter, which the shared root loads for both designs), a 24px track
 * with 2px padding and gap, 20px segments with 10px sides, and each segment
 * as wide as the same word is in the new design, where Classic is the plain
 * weight and New the bold one. Only the colors are the classic palette, since
 * the new design's styles never load here.
 *
 * <p>With an end date it sits in a warning pill (the new design shows only
 * the icon), with the same notice (useDesignNotice): it opens by itself once
 * per sign in, and closing it in either design closes it in both. The pill
 * only adds a tinted edge around them: the label, the switch, the icon and
 * the notice sit exactly where the new design's do.
 *
 * <p>Picking New saves it for this person and reloads the page they are on in
 * the new design, at the same address. A full load on purpose: each design
 * has its own styles, and one's must not linger on the other's pages.
 */

const INTER = "var(--font-inter), system-ui, sans-serif";

/**
 * A segment's text, with room kept for the word at the weight the new design
 * draws it in, so the segment is exactly as wide as there.
 */
function Word({ text, shown, sized }: { text: string; shown: number; sized: number }) {
  // The kept room sets the width; the word shown floats over it, centered,
  // so a bolder word than the new design's never widens the segment.
  return (
    <span className="relative inline-block">
      <span aria-hidden className="invisible" style={{ fontWeight: sized }}>
        {text}
      </span>
      <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap" style={{ fontWeight: shown }}>
        {text}
      </span>
    </span>
  );
}

const SEGMENT = "inline-flex h-5 flex-none items-center justify-center whitespace-nowrap rounded px-2.5 transition-colors";

export function ClassicDesignSwitch({
  spot,
  classicUntil = null,
  signInId = "session",
}: {
  spot: SwitchSpot;
  classicUntil?: string | null;
  signInId?: string;
}) {
  const noticeId = useId();
  const { open, pinned, setHovering, close } = useDesignNotice(classicUntil, signInId);

  function openNew() {
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.assign(switchHref("new", here, { viaSwitch: true }));
  }

  const control = (
    <>
      <span
        className={`hidden flex-none whitespace-nowrap uppercase lg:inline ${
          classicUntil ? "text-amber-700 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-500"
        }`}
        style={{ font: `600 10px/1 ${INTER}`, letterSpacing: "0.08em" }}
      >
        Design
      </span>
      <div
        role="radiogroup"
        aria-label="Design"
        className="inline-flex flex-none items-center rounded-lg bg-zinc-200/70 dark:bg-zinc-800"
        style={{ height: 24, padding: 2, gap: 2, boxSizing: "border-box", font: `500 12px/16px ${INTER}` }}
      >
        <button
          type="button"
          role="radio"
          aria-checked="true"
          className={`${SEGMENT} bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white`}
        >
          <Word text="Classic" shown={600} sized={500} />
        </button>
        <button
          type="button"
          role="radio"
          aria-checked="false"
          onClick={openNew}
          title="Switch to the new design"
          className={`${SEGMENT} text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-white`}
        >
          <Word text="New" shown={500} sized={600} />
        </button>
      </div>
    </>
  );

  // The spot is measured from the window's right edge, which is this bar's.
  // With the pill, its 3px right edge sits past the icon, so the icon stays
  // on the new design's spot.
  const edge = classicUntil ? 3 : 0;
  const place = {
    ["--spot-narrow" as string]: `${spot.narrow - edge}px`,
    ["--spot-wide" as string]: `${spot.wide - edge}px`,
  };
  const at = "absolute top-1/2 -translate-y-1/2 right-[var(--spot-narrow)] lg:right-[var(--spot-wide)]";

  if (!classicUntil) {
    return (
      <span className={`${at} inline-flex flex-none items-center gap-2.5`} style={place}>
        {control}
      </span>
    );
  }

  return (
    <span
      className={`${at} inline-flex h-8 flex-none items-center gap-2.5 rounded-full bg-amber-50 pl-3 pr-[3px] ring-1 ring-inset ring-amber-300 dark:bg-amber-950/40 dark:ring-amber-800`}
      style={place}
    >
      {control}
      <button
        type="button"
        aria-label="About the classic design"
        aria-describedby={open ? noticeId : undefined}
        aria-expanded={open}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        onClick={() => setHovering(true)}
        className={`grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-amber-700 transition-colors hover:bg-white dark:text-amber-400 dark:hover:bg-zinc-900 ${
          open ? "bg-white dark:bg-zinc-900" : ""
        }`}
      >
        <TriangleAlert className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={noticeId}
          role={pinned ? "dialog" : "tooltip"}
          aria-label={pinned ? "Classic design ending" : undefined}
          // Offset by the pill's edge, so it opens where the new design's does.
          className="absolute right-[3px] top-[calc(100%+5px)] z-50 flex w-[320px] gap-3 rounded-[14px] bg-white p-3.5 shadow-[0_18px_40px_-12px_rgba(16,24,40,0.25),0_0_0_1px_rgba(17,24,39,0.06)] dark:bg-zinc-900 dark:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.6),0_0_0_1px_rgba(63,63,70,1)]"
          style={{ fontFamily: INTER }}
          // Moving onto the card keeps a hover-opened card open, so its text
          // can be read without it vanishing under the pointer.
          onMouseEnter={() => !pinned && setHovering(true)}
          onMouseLeave={() => !pinned && setHovering(false)}
        >
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            <TriangleAlert className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-zinc-900 dark:text-white" style={{ font: `600 14px/20px ${INTER}` }}>
              Classic design ends {classicUntil}
            </span>
            <span className="text-zinc-600 dark:text-zinc-400" style={{ font: `400 13px/20px ${INTER}`, textWrap: "pretty" }}>
              Until then, you can switch between the classic and new designs at any time. After this date, the new
              design will be the only design available.
            </span>
          </span>
          {pinned && (
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-1 -mt-1 grid h-7 w-7 flex-none place-items-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </span>
  );
}
