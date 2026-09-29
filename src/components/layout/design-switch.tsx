"use client";

import { useEffect, useId, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { TriangleAlert, X } from "lucide-react";
import { SegmentedControl } from "@/components/ui";
import { switchedHref } from "@/lib/design-switch";

/**
 * Classic or New, beside the navigation layout control: both are how the
 * product looks, not what it does. Picking Classic opens this same page in the
 * classic design; this site is always New. See lib/design-switch.
 *
 * <p>Drawn the way the Layout handoff draws the Nav switch beside it: a small
 * caps label and a small segmented control. The handoff has no design switch,
 * so this is its language applied to one.
 *
 * <p>When the classic design has an end date, the switch sits in a warning
 * pill with an icon that explains it. The explanation opens by itself once
 * after every sign in, pinned, and closes only with its X; after that,
 * hovering or focusing the icon shows it until the pointer leaves. "Closed
 * for this sign in" is remembered per browser against the sign in's own id,
 * so signing out and back in brings it up again.
 */
const SEEN_KEY = "ct.design-notice.closed";

function closedFor(signInId: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === signInId;
  } catch {
    return false;
  }
}

function rememberClosed(signInId: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, signInId);
  } catch {
    // Storage blocked: it simply opens again on the next page load.
  }
}

export function DesignSwitch({
  classicUrl,
  classicUntil = null,
  signInId = "session",
}: {
  classicUrl: string;
  /** "November 1, 2026", or null for no end date and no notice. */
  classicUntil?: string | null;
  signInId?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const noticeId = useId();
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);

  // Opens by itself once per sign in. Read after mount, since storage only
  // exists in the browser; deferred so the effect does not set state inline.
  useEffect(() => {
    if (!classicUntil || closedFor(signInId)) return;
    const t = setTimeout(() => setPinned(true), 0);
    return () => clearTimeout(t);
  }, [classicUntil, signInId]);

  const open = pinned || hovering;

  function close() {
    setPinned(false);
    setHovering(false);
    rememberClosed(signInId);
  }

  const control = (
    <>
      <span
        className="flex-none whitespace-nowrap uppercase"
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
          if (next === "classic") window.location.assign(switchedHref(classicUrl, pathname, search.toString()));
        }}
        items={[
          { value: "classic", label: "Classic" },
          { value: "new", label: "New" },
        ]}
      />
    </>
  );

  if (!classicUntil) return <span className="inline-flex flex-none items-center gap-2.5">{control}</span>;

  return (
    <span
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
