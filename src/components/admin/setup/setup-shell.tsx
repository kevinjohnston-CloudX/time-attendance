"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ElementType, type ReactNode } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { LinkButton, PageHeader, PinnedBar } from "@/components/ui";
import { isPhone } from "@/lib/phone";
import phone from "./setup-phone.module.css";

/**
 * The frame Company Setup and Rules Setup share: a pinned header, the areas
 * down a rail on the left in groups with how many active records each
 * holds, and the open area filling the rest.
 *
 * <p>The open area is the page's own state, mirrored into `?tab=` with
 * history.replaceState, so a reload or a copied link opens the same area
 * and switching never refetches.
 */

const noSubscribe = () => () => {};

export interface ShellArea<T extends string> {
  id: T;
  label: string;
  icon?: ElementType;
  /** How many active records it holds, or a word such as "Off". */
  count?: number | string;
}

export function SetupShell<T extends string>({
  title,
  subtitle,
  path,
  back = { href: "/admin", label: "Administration" },
  actions,
  railLabel,
  groups,
  active,
  onPick,
  phoneList = false,
  children,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  /** This page's address, for the `?tab=` mirror. Left out, nothing is mirrored. */
  path?: string;
  back?: { href: string; label: string };
  /** Anything after the back link, such as Save. */
  actions?: ReactNode;
  railLabel?: string;
  groups: { title: string; areas: ShellArea<T>[] }[];
  active: T;
  onPick: (id: T) => void;
  /**
   * On a phone, show the areas as a list of their own and the picked one
   * after it, with a way back (the two hub pages). Left off (the editors,
   * whose rail jumps between sections of one long form), a phone gets a
   * Jump to picker over the form instead of the long rail.
   */
  phoneList?: boolean;
  children: ReactNode;
}) {
  /**
   * On a phone, whether the open area shows instead of the list of areas. A
   * phone shows the two one after the other (setup-phone.module.css). A link
   * that names an area (?tab=) opens on it; otherwise a phone starts on the
   * list. Opening one adds a history entry, so the phone's own Back gesture
   * returns to the list rather than leaving the page.
   */
  // Read after the page is drawn (the server has no address bar), then
  // overridden by whatever the person does.
  const linkedArea = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).has("tab"),
    () => false,
  );
  const [phoneChoice, setPhoneOpen] = useState<boolean | null>(null);
  const phoneOpen = phoneChoice ?? linkedArea;
  const pushedRef = useRef(false);
  const listScroll = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scroller = () => rootRef.current?.closest("main") ?? null;

  useEffect(() => {
    const onPop = () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      setPhoneOpen(false);
      requestAnimationFrame(() => scroller()?.scrollTo({ top: listScroll.current }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function pick(id: T) {
    onPick(id);
    if (phoneList && isPhone()) {
      listScroll.current = scroller()?.scrollTop ?? 0;
      setPhoneOpen(true);
      if (path && !pushedRef.current) {
        window.history.pushState(window.history.state, "", `${path}?tab=${id}`);
        pushedRef.current = true;
      } else if (path) {
        window.history.replaceState(window.history.state, "", `${path}?tab=${id}`);
      }
      requestAnimationFrame(() => scroller()?.scrollTo({ top: 0 }));
      return;
    }
    if (path) window.history.replaceState(window.history.state, "", `${path}?tab=${id}`);
  }

  function backToAreas() {
    if (pushedRef.current) {
      window.history.back();
      return;
    }
    setPhoneOpen(false);
    requestAnimationFrame(() => scroller()?.scrollTo({ top: listScroll.current }));
  }

  // The rail pins just under the header and reaches the bottom of the window.
  const barRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [rail, setRail] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const bar = barRef.current;
      const el = railRef.current;
      if (!bar || !el) return;
      if (!window.matchMedia("(min-width: 1024px) and (min-height: 600px)").matches) return setRail(null);
      // At rest the rail sits 4px under the bar: the bar's 12px bottom
      // padding comes back as a -12px margin, then the 16px gap.
      const top = Math.round(bar.getBoundingClientRect().height) + 4;
      const height = Math.max(280, Math.floor(window.innerHeight - Math.max(el.getBoundingClientRect().top, top + 40) - 24));
      setRail((prev) => (prev && prev.top === top && prev.height === height ? prev : { top, height }));
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onChange) : null;
    if (barRef.current) ro?.observe(barRef.current);
    document.addEventListener("scroll", onChange, { capture: true, passive: true });
    window.addEventListener("resize", onChange, { passive: true });
    return () => {
      ro?.disconnect();
      document.removeEventListener("scroll", onChange, { capture: true });
      window.removeEventListener("resize", onChange);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    // --shell-top is where the pinned bar ends, for anything that scrolls a
    // section into view to stop under it rather than behind it.
    <div
      ref={rootRef}
      className={`${phone.shell} flex flex-col gap-4`}
      data-phone-view={phoneList ? (phoneOpen ? "area" : "areas") : "sections"}
      style={{ ["--shell-top" as string]: `${rail?.top ?? 96}px` }}
    >
      <PinnedBar barRef={barRef}>
        <PageHeader
          title={title}
          subtitle={subtitle}
          actions={
            <>
              {/* On a hub page Menu reaches Administration on a phone; an
                  editor keeps its way back to its list. */}
              <LinkButton
                href={back.href}
                hierarchy="tertiary"
                className={phoneList ? "ta-phone-hide" : undefined}
                leadingIcon={<ArrowLeft className="h-4 w-4" />}
              >
                {back.label}
              </LinkButton>
              {actions}
            </>
          }
        />
      </PinnedBar>

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <nav
          ref={railRef}
          aria-label={railLabel ?? (typeof title === "string" ? `${title} areas` : "Areas")}
          className={`${phone.rail} ta-card ta-scroll w-full flex-none overflow-y-auto lg:sticky lg:w-[248px]`}
          style={{ top: rail?.top, maxHeight: rail?.height, borderRadius: "var(--radius-l)" }}
        >
          {groups.map((g, i) => (
            <div
              key={g.title}
              className="flex flex-col gap-0.5 px-2 py-2.5"
              style={i ? { borderTop: "1px solid var(--stroke-divider)" } : undefined}
            >
              <span className="wms-overline px-2.5 pb-1 pt-0.5">{g.title}</span>
              {g.areas.map((a) => (
                <AreaLink key={a.id} area={a} selected={a.id === active} onPick={() => pick(a.id)} />
              ))}
            </div>
          ))}
        </nav>

        <div className={`${phone.area} flex w-full min-w-0 flex-1 flex-col gap-3`}>
          {phoneList ? (
            <div className="ta-phone-only">
              <button type="button" className={phone.back} onClick={backToAreas}>
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                {typeof title === "string" ? title : "Back"}
              </button>
            </div>
          ) : (
            <div className="ta-phone-only">
              <label className={phone.jump}>
                <span>Jump to</span>
                <select
                  className="ta-field"
                  value={active}
                  onChange={(e) => pick(e.target.value as T)}
                  aria-label={railLabel ?? "Sections"}
                >
                  {groups.map((g) => (
                    <optgroup key={g.title} label={g.title}>
                      {g.areas.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

function AreaLink<T extends string>({ area, selected, onPick }: { area: ShellArea<T>; selected: boolean; onPick: () => void }) {
  const Icon = area.icon;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={selected ? "page" : undefined}
      className={`${phone.areaLink} flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left ${selected ? "" : "ta-hoverable"}`}
      style={{ border: 0, cursor: "pointer", background: selected ? "var(--surface-info)" : "transparent" }}
    >
      {Icon && (
        <Icon
          className="h-4 w-4 flex-none"
          style={{ color: selected ? "var(--icon-accent)" : "var(--icon-tertiary)" }}
          aria-hidden="true"
        />
      )}
      <span
        className="min-w-0 flex-1 truncate"
        style={{
          font: "var(--type-body1)",
          fontWeight: selected ? "var(--weight-semibold)" : "var(--weight-medium)",
          color: selected ? "var(--text-accent)" : "var(--text-primary)",
        }}
      >
        {area.label}
      </span>
      <span
        className="tabular flex-none"
        title={typeof area.count === "number" ? `${area.count} active` : undefined}
        style={{ font: "var(--type-caption1)", color: selected ? "var(--text-accent)" : "var(--text-tertiary)" }}
      >
        {area.count}
      </span>
      <span className="ta-phone-only">
        <ChevronRight className={phone.chevron} aria-hidden="true" />
      </span>
    </button>
  );
}
