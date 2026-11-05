import type { ReactNode } from "react";

/**
 * The pieces a page's loading screen is drawn with, for the pages whose
 * `loading.tsx` traces their own layout inside the portal shell: the sidebar
 * and the top bar stay where they are, and only the page area shows its
 * shape until the real one streams in.
 *
 * <p>The same bars, cards and header the older loading screens draw by hand
 * (Exceptions, Live Attendance, Team Leave), in one place, so a new loading
 * screen is a layout and not another copy of them.
 */

export function Bar({ w, h = 12, r = 6 }: { w: string | number; h?: number; r?: number }) {
  return (
    <span
      className="block animate-pulse"
      style={{ width: w, height: h, flex: "none", borderRadius: r, background: "var(--ta-skeleton)" }}
    />
  );
}

/** The page title and its one line, as PageHeader draws them. */
export function SkeletonHeader({ action = false }: { action?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Bar w={240} h={30} r={8} />
        <Bar w={320} />
      </div>
      {action && <Bar w={120} h={32} r={8} />}
    </div>
  );
}

/** A card as the shared Card draws it: its header, a rule, then the body. */
export function SkeletonCard({
  title = true,
  children,
  padding = 16,
}: {
  title?: boolean;
  children?: ReactNode;
  padding?: number;
}) {
  return (
    <section
      className="flex flex-col"
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-l)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      {title && (
        <header
          className="flex flex-col gap-2"
          style={{ padding: "14px 16px", borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <Bar w={150} h={16} />
          <Bar w={210} h={10} />
        </header>
      )}
      <div className="flex flex-col gap-3" style={{ padding }}>
        {children}
      </div>
    </section>
  );
}

/** A run of table or list rows. */
export function SkeletonRows({ rows, h = 14 }: { rows: number; h?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Bar w="22%" h={h} />
          <Bar w="18%" h={h} />
          <span className="flex-1" />
          <Bar w="12%" h={h} />
        </div>
      ))}
    </>
  );
}

/** A filter or search row, as the shared Toolbar draws it. */
export function SkeletonToolbar({ chips = 3 }: { chips?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Bar w={260} h={32} r={8} />
      {Array.from({ length: chips }, (_, i) => (
        <Bar key={i} w={[96, 120, 84, 108][i % 4]} h={28} r={999} />
      ))}
    </div>
  );
}

/**
 * A table card: its column header on the quiet band, then rows at the shared
 * table's height, the columns at widths that vary the way real names do.
 */
export function SkeletonTable({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  const widths = ["70%", "55%", "45%", "60%", "40%", "50%"];
  const grid = { display: "grid", gridTemplateColumns: `1.6fr repeat(${columns - 1}, minmax(0, 1fr))`, gap: 16 };
  return (
    <section
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-l)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <div style={{ ...grid, alignItems: "center", height: 40, padding: "0 16px", borderBottom: "1px solid var(--stroke-divider)" }}>
        {Array.from({ length: columns }, (_, c) => (
          <Bar key={c} w={c ? 56 : 88} h={10} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          style={{ ...grid, alignItems: "center", height: 48, padding: "0 16px", borderTop: r ? "1px solid var(--stroke-divider)" : undefined }}
        >
          {Array.from({ length: columns }, (_, c) => (
            <Bar key={c} w={widths[(r + c * 2) % widths.length]} h={c ? 11 : 13} />
          ))}
        </div>
      ))}
    </section>
  );
}

/**
 * The wrapper every one of these screens shares, announced as loading. It
 * stays invisible for its first 150ms (.ta-loading), so a page that arrives
 * at once never flashes it.
 */
export function SkeletonPage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ta-loading flex flex-col gap-4" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}
