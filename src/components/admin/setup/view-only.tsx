"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether the setup screens inside are for looking only: a role with Rule
 * Sets or Sites on Read, not Write (RULES_VIEW, SITE_VIEW).
 *
 * <p>Read where the shared pieces draw their changes: AreaPanel and the
 * managers leave out Add, SetupDialog and EditorPage switch every field off
 * and drop Save, and DeleteSection is left out. The server refuses a save
 * from such a role either way; this is so the screen never offers one.
 */
const ViewOnlyContext = createContext(false);

export function ViewOnly({ on = true, children }: { on?: boolean; children: ReactNode }) {
  return <ViewOnlyContext.Provider value={on}>{children}</ViewOnlyContext.Provider>;
}

export function useViewOnly(): boolean {
  return useContext(ViewOnlyContext);
}
