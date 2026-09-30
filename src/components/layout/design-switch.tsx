"use client";

import { useEffect, useId, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { TriangleAlert, X } from "lucide-react";
import { SegmentedControl } from "@/components/ui";
import { switchHref } from "@/lib/design-switch";
import { rememberSwitchSpot, useDesignNotice } from "./use-design-notice";

/**
 * Classic or New, beside the navigation layout control: both are how the
 * product looks, not what it does. Picking Classic saves it for this person
 * and reloads this same page in the classic design (one app, same address).
 * See lib/design-switch.
 *
 * <p>Drawn the way the Layout handoff draws the Nav switch beside it: a small
 * caps label and a small segmented control. The handoff has no design switch,
 * so this is its language applied to one.
 *
 * <p>When the classic design has an end date, the switch sits in a warning
 * pill with an icon that explains it (see useDesignNotice for when the
 * explanation opens).
 *
 * <p>It records where it sits (rememberSwitchSpot), so the classic design's
 * switch is drawn at exactly the same spot and nothing moves on a flip.
 */

export function DesignSwitch({
  classicUntil = null,
  signInId = "session",
}: {
  /** "November 1, 2026", or null for no end date and no notice. */
  classicUntil?: string | null;
  signInId?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const noticeId = useId();
  const { open, pinned, setHovering, close } = useDesignNotice(classicUntil, signInId);
  const spotRef = useRef<HTMLSpanElement>(null);

  // Where it sits now, and again whenever the window changes size.
  useEffect(() => {
    const save = () => spotRef.current && rememberSwitchSpot(spotRef.current);
    save();
    window.addEventListener("resize", save);
    return () => window.removeEventListener("resize", save);
  }, []);

  const control = (
    <>
      <span
        className="hidden flex-none whitespace-nowrap uppercase lg:inline"
        style={{
          font: "var(--weight-semibold) 10px/1 var(--font-sans)",
          letterSpacing: "0.08em",
          color: classicUntil ? "var(--text-warning)" : "var(--text-tertiary)",
        }}
      >
        Design
      </span>
      <SegmentedControl
        size="sm"
        ariaLabel="Design"
        value="new"
        onChange={(next) => {
          if (next !== "classic") return;
          // Measured once more on the way out, so the classic switch lands on
          // the spot this one is on right now.
          if (spotRef.current) rememberSwitchSpot(spotRef.current);
          const here = `${pathname}${search.size ? `?${search.toString()}` : ""}`;
          // A full load: the two designs have their own styles, and one
          // design's must not linger on the other's pages.
          window.location.assign(switchHref("classic", here, { viaSwitch: true }));
        }}
        items={[
          { value: "classic", label: "Classic" },
          { value: "new", label: "New" },
        ]}
      />
    </>
  );

  if (!classicUntil) {
    return (
      <span ref={spotRef} className="inline-flex flex-none items-center gap-2.5">
        {control}
      </span>
    );
  }

  return (
    <span
      ref={spotRef}
      className="relative inline-flex h-8 flex-none items-center gap-2 rounded-full pl-3 pr-[3px]"
      style={{ background: "var(--surface-warning)", boxShadow: "inset 0 0 0 1px var(--stroke-warning)" }}
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
        className="ta-warn-btn grid h-[26px] w-[26px] flex-none place-items-center rounded-full"
        style={{ color: "var(--icon-warning)" }}
      >
        <TriangleAlert className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={noticeId}
          role={pinned ? "dialog" : "tooltip"}
          aria-label={pinned ? "Classic design ending" : undefined}
          className="absolute right-0 top-[calc(100%+8px)] z-50 flex w-[320px] gap-3 rounded-[14px] p-3.5"
          style={{ background: "var(--surface-card)", boxShadow: "var(--ta-drop-shadow)" }}
          // Moving onto the card keeps a hover-opened card open, so its text
          // can be read without it vanishing under the pointer.
          onMouseEnter={() => !pinned && setHovering(true)}
          onMouseLeave={() => !pinned && setHovering(false)}
        >
          <span
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
            style={{ background: "var(--surface-warning)", color: "var(--text-warning)" }}
          >
            <TriangleAlert className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
              Classic design ends {classicUntil}
            </span>
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
              Until then, you can switch between the classic and new designs at any time. After this date, the new
              design will be the only design available.
            </span>
          </span>
          {pinned && (
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="ta-pill-btn -mr-1 -mt-1 grid h-7 w-7 flex-none place-items-center rounded-full"
              style={{ color: "var(--icon-secondary)" }}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </span>
  );
}
