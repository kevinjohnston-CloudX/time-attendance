"use client";

import { useState } from "react";
import { Check, Loader2, Search, Undo2 } from "lucide-react";
import styles from "./view-as-list.module.css";

export type ViewAsOption = { id: string; name: string; liveAttendanceOnly?: boolean };

/** Two letters for a role's tile, from its own (renamable) name, never a fixed list. */
function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** More roles than this and a search field appears above the list. */
const SEARCH_FROM = 8;

/**
 * The roles a person can view CloudTime as, and the way back to their own
 * view. One list for the computer's account menu and the phone's View as
 * screen, drawn at two densities, so the choices and their wording never
 * differ between them.
 *
 * <p>Each role is a row with a tile of its initials, its name, and a quiet tag
 * when it only opens Live Attendance; the role on screen now is ticked. A
 * company with many roles gets a search field. Return sits apart at the foot,
 * so it is never mistaken for one more role.
 */
export function ViewAsList({
  variant,
  roles,
  current,
  realRoleLabel,
  pending,
  onPick,
  onReturn,
}: {
  variant: "menu" | "phone";
  roles: ViewAsOption[];
  /** The name of the role being viewed as now, if any. */
  current: string | null;
  realRoleLabel: string;
  pending: boolean;
  onPick: (id: string) => void;
  onReturn: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const shown = q ? roles.filter((r) => r.name.toLowerCase().includes(q)) : roles;

  return (
    <div className={styles.list} data-variant={variant}>
      {roles.length > SEARCH_FROM && (
        <label className={styles.search}>
          <Search className={styles.searchIcon} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a role"
            aria-label="Find a role"
            autoComplete="off"
            data-1p-ignore
          />
        </label>
      )}

      <div className={styles.rows} role="group" aria-label="Roles">
        {roles.length === 0 && <p className={styles.empty}>There are no other roles to view as.</p>}
        {roles.length > 0 && shown.length === 0 && <p className={styles.empty}>No role matches “{query.trim()}”.</p>}
        {shown.map((r) => {
          const on = r.name === current;
          const busy = pending && picked === r.id;
          return (
            <button
              key={r.id}
              type="button"
              role="menuitemradio"
              aria-checked={on}
              className={styles.role}
              data-on={on || undefined}
              disabled={pending || on}
              onClick={() => {
                setPicked(r.id);
                onPick(r.id);
              }}
            >
              <span className={styles.tile} aria-hidden="true">
                {monogram(r.name)}
              </span>
              <span className={styles.text}>
                <span className={styles.name} title={r.name}>
                  {r.name}
                </span>
                {r.liveAttendanceOnly && <span className={styles.tag}>Live Attendance only</span>}
              </span>
              {busy ? (
                <Loader2 className={`${styles.mark} animate-spin`} aria-label="Switching" />
              ) : on ? (
                <span className={styles.current}>
                  <Check className={styles.mark} aria-hidden="true" />
                  <span className="sr-only">Current view</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {current && (
        <button type="button" role="menuitem" className={styles.back} disabled={pending} onClick={onReturn}>
          <span className={styles.backIcon} aria-hidden="true">
            <Undo2 />
          </span>
          <span className={styles.text}>
            <span className={styles.name}>Return to {realRoleLabel}</span>
            <span className={styles.backBody}>Your own view, with all your access</span>
          </span>
        </button>
      )}
    </div>
  );
}
