"use client";

import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { findOnSitePeople } from "@/actions/presence.actions";
import type { PickablePerson } from "@/lib/presence/people-search.service";
import { Face } from "./face";
import { initialsOf } from "./presence-meta";
import styles from "./on-site.module.css";

/**
 * The Live Attendance search: type to narrow the page as before, or pick
 * people to keep, several at once. Picked people sit in the box as chips and
 * every tab shows only them (plus whoever matches what is still being typed),
 * so four people can be followed together through Movements, People and the
 * Scan log.
 *
 * <p>Suggestions come from the server, so they cover everyone this site's
 * pages can show, not only who is on today's board. A pasted list of names,
 * separated by commas, semicolons or lines, adds everyone it can match and
 * says which names it could not.
 *
 * <p>Keyboard: arrows move through the suggestions, Enter picks, Backspace on
 * an empty box removes the last chip, Escape closes the list.
 */

const SUGGEST_DELAY_MS = 200;

/** A picked person's name, with their code when another picked person shares it. */
export function pickedLabel(p: PickablePerson, all: PickablePerson[]): string {
  const twin = all.some((o) => o.id !== p.id && o.name.toLowerCase() === p.name.toLowerCase());
  return twin ? `${p.name} (${p.employeeCode})` : p.name;
}

type Note = { tone: "info" | "warning"; text: string } | null;

export function PeopleSearch({
  siteId,
  picked,
  onPickedChange,
  text,
  onTextChange,
  max,
  onBadgeHolders,
}: {
  siteId: string;
  picked: PickablePerson[];
  onPickedChange: (next: PickablePerson[]) => void;
  text: string;
  onTextChange: (next: string) => void;
  max: number;
  /** Who holds the badge number typed, for the tables to match it too. */
  onBadgeHolders?: (forText: string, ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<{ for: string; people: PickablePerson[] }>({ for: "", people: [] });
  const [active, setActive] = useState(0);
  const [note, setNote] = useState<Note>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const pickedRef = useRef(picked);
  const onBadgeHoldersRef = useRef(onBadgeHolders);
  useEffect(() => {
    onBadgeHoldersRef.current = onBadgeHolders;
  }, [onBadgeHolders]);
  useEffect(() => {
    pickedRef.current = picked;
  }, [picked]);

  // Suggestions follow the typing after a short pause; a slow answer for
  // text already changed is dropped.
  const needle = text.trim();
  useEffect(() => {
    if (!needle) return;
    let live = true;
    const t = setTimeout(async () => {
      const res = await findOnSitePeople({ siteId, q: needle, exclude: pickedRef.current.map((p) => p.id) }).catch(() => null);
      if (!live) return;
      const people = res?.success && res.data.kind === "suggest" ? res.data.people : [];
      setFound({ for: needle, people });
      onBadgeHoldersRef.current?.(needle, people.filter((p) => p.badge).map((p) => p.id));
      setActive(0);
    }, SUGGEST_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [needle, siteId]);

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Only the answer for what is typed now counts; until it lands, it is loading.
  const loading = !!needle && found.for !== needle;
  const options = useMemo(
    () => (needle && found.for === needle ? found.people.filter((p) => !picked.some((x) => x.id === p.id)) : []),
    [needle, found, picked],
  );
  const full = picked.length >= max;

  function add(people: PickablePerson[]) {
    const have = new Set(picked.map((p) => p.id));
    const fresh = people.filter((p) => !have.has(p.id));
    const room = Math.max(0, max - picked.length);
    onPickedChange([...picked, ...fresh.slice(0, room)]);
    return { added: Math.min(fresh.length, room), over: Math.max(0, fresh.length - room) };
  }

  function pick(p: PickablePerson) {
    add([p]);
    onTextChange("");
    setNote(null);
    inputRef.current?.focus();
  }

  function remove(id: string) {
    onPickedChange(picked.filter((p) => p.id !== id));
    inputRef.current?.focus();
  }

  async function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    const names = pasted
      .split(/[,;\n\r\t]+/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length < 2) return; // One name is ordinary typing.
    e.preventDefault();
    setOpen(true);
    setNote({ tone: "info", text: `Looking up ${names.length} names` });
    const res = await findOnSitePeople({ siteId, names }).catch(() => null);
    if (!res?.success || res.data.kind !== "names") {
      setNote({ tone: "warning", text: "Those names could not be looked up. Try again." });
      return;
    }
    const { found, missing, unclear, several } = res.data;
    const { added, over } = add(found);
    const parts = [
      added ? `Added ${added} ${added === 1 ? "person" : "people"}.` : "Nobody new was added.",
      several.length
        ? `${several.map((x) => `"${x.text}" matched ${x.count} records`).join(", ")}; all were added, so remove any you do not need.`
        : "",
      missing.length ? `No one found for ${missing.map((m) => `"${m}"`).join(", ")}.` : "",
      unclear.length
        ? `${unclear.map((u) => `"${u.text}"`).join(", ")} matched more than one person. Search for ${unclear.length === 1 ? "it" : "them"} again to choose.`
        : "",
      over ? `${over} more did not fit. A search holds up to ${max} people.` : "",
    ].filter(Boolean);
    setNote({ tone: missing.length || unclear.length || over ? "warning" : "info", text: parts.join(" ") });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      if (open && options[active] && !full) {
        e.preventDefault();
        pick(options[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
    } else if (e.key === "Backspace" && !text && picked.length) {
      remove(picked[picked.length - 1].id);
    }
  }

  const showList = open && (!!needle || !!note);

  return (
    <div ref={wrapRef} className={styles.psWrap}>
      <div
        className={`ta-field ${styles.psField}`}
        data-has-picks={picked.length ? "true" : undefined}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <Search className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
        {picked.map((p) => (
          <span key={p.id} className={styles.psChip} title={`${p.name} · ${p.employeeCode}`}>
            <span className="truncate">{pickedLabel(p, picked)}</span>
            <button type="button" className={styles.psChipX} aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)}>
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="search"
          name="q"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && options[active] ? `${listId}-${options[active].id}` : undefined}
          aria-label="Search people by name, employee code or badge"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          value={text}
          placeholder={picked.length ? "Add another person" : "Name, employee code or badge"}
          className={styles.psInput}
          onChange={(e) => {
            onTextChange(e.target.value);
            setOpen(true);
            setNote(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {(picked.length > 1 || (picked.length > 0 && text)) && (
          <button
            type="button"
            className={styles.psClear}
            aria-label="Clear the search"
            title="Clear the search"
            onClick={() => {
              onPickedChange([]);
              onTextChange("");
              setNote(null);
              inputRef.current?.focus();
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {showList && (
        <div className={styles.psPanel}>
          {note && (
            <p className={styles.psNote} data-tone={note.tone} role="status">
              {note.text}
            </p>
          )}
          {needle && (
            <ul id={listId} role="listbox" aria-label="People" className={styles.psList}>
              {full ? (
                <li className={styles.psEmpty}>A search holds {max} people. Remove one to add another.</li>
              ) : options.length ? (
                options.map((p, i) => (
                  <li
                    key={p.id}
                    id={`${listId}-${p.id}`}
                    role="option"
                    aria-selected={i === active}
                    className={styles.psOption}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(p);
                    }}
                  >
                    <span className={styles.psFace}>
                      <span className={styles.initials} style={{ fontSize: 12 }} aria-hidden="true">
                        {initialsOf(p.name)}
                      </span>
                      <Face src={p.photoUrl} personId={p.id} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={styles.psName}>{p.name}</span>
                      <span className={styles.psMeta}>
                        {[p.badge ? `Badge ${p.badge}` : null, p.employeeCode, p.department].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {p.inactive && <span className={styles.psTag}>Inactive</span>}
                  </li>
                ))
              ) : loading ? (
                <li className={styles.psEmpty}>Searching</li>
              ) : (
                <li className={styles.psEmpty}>Nobody at this site matches &ldquo;{needle}&rdquo;.</li>
              )}
            </ul>
          )}
          <p className={styles.psHint}>Pick people to follow several at once. To add a list, paste names or badge numbers separated by commas.</p>
        </div>
      )}
    </div>
  );
}
