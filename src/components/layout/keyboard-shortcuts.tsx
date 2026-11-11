"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Keyboard } from "lucide-react";
import { collapseStore, navModeStore, useNavMode } from "./nav-mode";
import { Window, WindowCard } from "@/components/ui/window";

/**
 * The shortcuts button in the top bar, the list behind it, and the keys
 * themselves.
 *
 * <p>All three live together on purpose. A modal that documents shortcuts
 * some other file registers is a modal that goes out of date the first time
 * somebody adds a key, and a list that claims a shortcut the viewer cannot
 * use is worse than no list: it sends a warehouse employee to a page that
 * bounces them back to the dashboard.
 *
 * <p>So the table below is the only place a shortcut is written down, and
 * every row is filtered against the same permission-resolved nav the sidebar
 * and the command palette are built from. A row that is not listed is also
 * not registered.
 */

/** The jump targets, in the order the list draws them. */
const GO_TO = [
  { key: "d", what: "Go to Dashboard",       href: "/dashboard" },
  { key: "p", what: "Go to Punch Clock",     href: "/time/punch" },
  { key: "t", what: "Go to My Timesheet",    href: "/time/timesheet" },
  { key: "e", what: "Go to Exceptions",      href: "/supervisor/exceptions" },
] as const;

/** How long "G" waits for its second key before it is forgotten. */
const SEQUENCE_WINDOW_MS = 1500;

const noSubscribe = () => () => {};
const useHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false);

/**
 * Whether the keystroke belongs to something the person is typing into.
 *
 * <p>Without this, "g" swallowed inside a search box navigates away mid-word
 * and "?" opens a dialog over a half-written note. Covers the editable hosts
 * the product actually uses: inputs, textareas, selects and anything
 * contenteditable, including inside an open dialog.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function KeyboardShortcuts({ reachableHrefs }: { reachableHrefs: string[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const navMode = useNavMode();
  const [open, setOpen] = useState(false);

  /** When "G" was pressed, or null. A ref because no render depends on it. */
  const pendingGoTo = useRef<number | null>(null);

  const reachable = new Set(reachableHrefs);
  const goTo = GO_TO.filter((g) => reachable.has(g.href));

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K belongs to the command palette, and every modifier combination is
      // somebody else's: the browser's, the operating system's, or a field's.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      if (e.key === "?") {
        e.preventDefault();
        pendingGoTo.current = null;
        setOpen((v) => !v);
        return;
      }

      // Escape belongs to the open window; here it only ends a G sequence.
      if (e.key === "Escape") {
        pendingGoTo.current = null;
        return;
      }

      // "[" collapses or expands the grouped sidebar, as the handoff has it.
      // The rail has no collapsed state, so there it does nothing.
      if (e.key === "[") {
        if (navModeStore.get() !== "grouped") return;
        e.preventDefault();
        pendingGoTo.current = null;
        collapseStore.set(!collapseStore.get());
        return;
      }

      if (e.key.toLowerCase() === "g") {
        pendingGoTo.current = Date.now();
        return;
      }

      const startedAt = pendingGoTo.current;
      if (startedAt === null) return;

      // Any key that is not a destination ends the sequence, so a stray "g"
      // cannot sit there and hijack a keystroke a minute later.
      pendingGoTo.current = null;
      if (Date.now() - startedAt > SEQUENCE_WINDOW_MS) return;

      const target = goTo.find((g) => g.key === e.key.toLowerCase());
      if (!target) return;
      e.preventDefault();
      setOpen(false);
      router.push(target.href);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // goTo is derived from the hrefs, which change only when the viewer does.
  }, [router, reachableHrefs.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rendered after hydration only: the server cannot know whether this
  // browser writes ⌘ or Ctrl, and guessing produces a mismatch.
  const isMac = hydrated && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
  const rows = shortcutRows(reachableHrefs, isMac, navMode === "grouped");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
        aria-haspopup="dialog"
        className="ta-pill-btn grid h-7 w-7 flex-none place-items-center rounded-full"
        style={{ color: "var(--icon-tertiary)" }}
      >
        <Keyboard className="h-4 w-4" />
      </button>

      {open && <ShortcutsDialog rows={rows} onClose={close} />}
    </>
  );
}

/** One row of the list: what it does, and the keys that do it. */
export type ShortcutRow = { what: string; keys: string };

/**
 * The rows for a viewer, in the order they are drawn.
 *
 * <p>Pure and exported so the list can be rendered and looked at without a
 * browser, a session or a database behind it.
 */
export function shortcutRows(reachableHrefs: string[], isMac: boolean, grouped = true): ShortcutRow[] {
  const reachable = new Set(reachableHrefs);
  return [
    { what: "Search and jump to a page", keys: isMac ? "\u2318 K" : "Ctrl K" },
    { what: "This list of shortcuts", keys: "?" },
    ...(grouped ? [{ what: "Collapse or expand the sidebar", keys: "[" }] : []),
    ...GO_TO.filter((g) => reachable.has(g.href)).map((g) => ({
      what: g.what,
      keys: `G then ${g.key.toUpperCase()}`,
    })),
    { what: "Close a panel or dialog", keys: "Esc" },
  ];
}

/** The list itself, on the shared window frame. Draws what it is given; the
 *  frame closes it on Escape, the X, Close or a click outside. */
export function ShortcutsDialog({
  rows,
  onClose,
}: {
  rows: ShortcutRow[];
  onClose: () => void;
}) {
  return (
    <Window
      size="sm"
      icon={<Keyboard />}
      title="Keyboard shortcuts"
      subtitle="Move around CloudTime without the mouse."
      foot="Shortcuts are off while you are typing in a field."
      onClose={onClose}
    >
      <WindowCard>
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((row, i) => (
            <li
              key={row.what}
              className="flex min-h-11 items-center gap-3 px-4 py-2"
              style={i > 0 ? { borderTop: "1px solid var(--stroke-divider)" } : undefined}
            >
              <span className="min-w-0 flex-1 truncate" style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}>
                {row.what}
              </span>
              <kbd
                className="tabular whitespace-nowrap rounded-md"
                style={{
                  font: "var(--weight-medium) 12px/18px var(--font-sans)",
                  color: "var(--text-secondary)",
                  background: "var(--ta-well)",
                  boxShadow: "inset 0 0 0 1px var(--ta-well-ring)",
                  padding: "1px 8px",
                }}
              >
                {row.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </WindowCard>
    </Window>
  );
}
