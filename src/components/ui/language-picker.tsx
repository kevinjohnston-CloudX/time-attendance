"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { floatingPortal, useOwnPresses } from "./floating-layer";
import { menuStyles } from "./menu";
import { LANGUAGES, languageName } from "@/lib/languages";

const GAP = 4;
const EDGE = 8;
const MAX_HEIGHT = 260;
const MIN_HEIGHT = 120;

/**
 * The list under the field and as wide as it, or over it when there is no
 * room below and more above, and never past an edge of the window. `side`
 * keeps the side already taken, so the list does not jump while the names
 * narrow; null decides it again. Returns the side.
 */
function placeList(list: HTMLElement, field: HTMLElement, side: boolean | null): boolean {
  const r = field.getBoundingClientRect();
  list.style.width = `${r.width}px`;
  list.style.left = `${r.left}px`;
  list.style.maxHeight = `${MAX_HEIGHT}px`;
  const height = list.offsetHeight;
  const below = window.innerHeight - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const up = side ?? (height > below && above > below);
  const room = Math.max(Math.min(up ? above : below, MAX_HEIGHT), MIN_HEIGHT);
  list.style.maxHeight = `${room}px`;
  list.style.top = `${up ? r.top - GAP - Math.min(height, room) : r.bottom + GAP}px`;
  return up;
}

/** Whether any of the field still shows inside every box that scrolls it. */
function inSight(field: HTMLElement): boolean {
  const r = field.getBoundingClientRect();
  if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
  for (let p = field.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === "visible") continue;
    const b = p.getBoundingClientRect();
    if (r.bottom <= b.top || r.top >= b.bottom) return false;
  }
  return true;
}

/**
 * Pick a language by typing: the list narrows to the languages whose name
 * (or code) matches, names starting with what was typed first. Arrow keys
 * move, Enter picks, Escape puts back what was there. 35 languages were a
 * long scroll in a plain dropdown.
 *
 * <p>Controlled: `value` is a language code (lib/languages.ts) or "" for none.
 * Under `name` the code also goes in a hidden field, for forms that read
 * FormData. Typing something that matches nothing and leaving keeps the
 * language that was there.
 */
export function LanguagePicker({
  id,
  name,
  value,
  onChange,
  emptyLabel = "Not set",
  exclude = [],
  disabled = false,
  "aria-label": ariaLabel,
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (code: string) => void;
  emptyLabel?: string;
  /** Codes not to offer (a site's primary, among its other languages). */
  exclude?: string[];
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const listId = `lang-${useId().replace(/:/g, "")}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sideRef = useRef<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null); // null while not typing
  const [active, setActive] = useState(0);

  const options = useMemo(() => {
    const offered = LANGUAGES.filter((l) => !exclude.includes(l.code));
    const q = (text ?? "").trim().toLowerCase();
    if (!q) return [{ code: "", name: emptyLabel }, ...offered];
    const starts = offered.filter((l) => l.name.toLowerCase().startsWith(q) || l.code === q);
    const within = offered.filter((l) => !starts.includes(l) && l.name.toLowerCase().includes(q));
    return [...starts, ...within];
  }, [text, exclude, emptyLabel]);

  function pick(code: string) {
    onChange(code);
    setText(null);
    setOpen(false);
  }

  function close() {
    // Leaving with an exact name typed picks it; anything else puts back what was there.
    const typed = (text ?? "").trim().toLowerCase();
    const exact = typed ? LANGUAGES.find((l) => l.name.toLowerCase() === typed && !exclude.includes(l.code)) : undefined;
    if (exact) onChange(exact.code);
    setText(null);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => {
        const n = options.length;
        if (!n) return 0;
        return e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
      });
    } else if (e.key === "Enter") {
      // Never the form's submit while the list is open.
      if (open) {
        e.preventDefault();
        const o = options[active];
        if (o) pick(o.code);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setText(null);
        setOpen(false);
      }
    }
  }

  const shown = text ?? (value ? languageName(value) : "");
  const listOpen = open && !disabled;

  // A press on the list is the list's alone, and the field keeps the focus
  // and the keys (see floating-layer.tsx).
  useOwnPresses(listRef);

  // Placed before it is painted, and again as the names narrow.
  useLayoutEffect(() => {
    const list = listRef.current;
    const field = inputRef.current;
    if (!listOpen || !list || !field) {
      sideRef.current = null;
      return;
    }
    sideRef.current = placeList(list, field, sideRef.current);
  }, [listOpen, options]);

  // The list follows its field when the page or a window scrolls, and closes
  // once the field has scrolled out of sight. It opens as the field takes the
  // focus, and the browser may scroll a window to bring that field into view,
  // so closing on any scroll would close it as it opens.
  useEffect(() => {
    if (!listOpen) return;
    const follow = (e: Event) => {
      const list = listRef.current;
      const field = inputRef.current;
      // A resize comes from the window itself, which is not on the page.
      if (!list || !field || (e.target instanceof Node && list.contains(e.target))) return;
      if (e.type === "scroll" && !inSight(field)) {
        setOpen(false);
        return;
      }
      // The field has moved, so the side is decided again.
      sideRef.current = placeList(list, field, null);
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [listOpen]);

  return (
    <div className="relative w-full min-w-0">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${options[active].code || "none"}` : undefined}
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore=""
        data-lpignore="true"
        disabled={disabled}
        value={shown}
        placeholder={emptyLabel}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(e) => {
          e.target.select();
          setActive(0);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
        className="ta-field h-8 w-full rounded-md pl-2.5 pr-8"
        style={{
          border: "1px solid var(--stroke-default)",
          background: disabled ? "var(--surface-secondary)" : "var(--surface-card)",
          color: "var(--text-primary)",
          font: "var(--type-body1)",
        }}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2"
        style={{ color: "var(--icon-tertiary)" }}
      />
      {name && <input type="hidden" name={name} value={value} />}
      {/* Drawn at the end of the page, so a window's scroll never clips it. */}
      {listOpen &&
        floatingPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Languages"
            className={`ta-scroll m-0 list-none ${menuStyles.panel} ${menuStyles.popover}`}
          >
            {options.length === 0 ? (
              <li className={menuStyles.empty}>No language matches &ldquo;{text}&rdquo;.</li>
            ) : (
              options.map((o, i) => (
                <li
                  key={o.code || "none"}
                  id={`${listId}-${o.code || "none"}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  // The press itself is held back (useOwnPresses), so the field
                  // keeps the focus and the list stays open until the click.
                  onClick={() => pick(o.code)}
                  data-chosen={(o.code === value && value !== "") || undefined}
                  className={menuStyles.option}
                  style={o.code ? undefined : { color: "var(--text-tertiary)" }}
                >
                  <span className="min-w-0 truncate">{o.name}</span>
                  {o.code === value && value !== "" && <Check className={menuStyles.optionCheck} aria-label="Selected" />}
                </li>
              ))
            )}
          </ul>,
        )}
    </div>
  );
}
