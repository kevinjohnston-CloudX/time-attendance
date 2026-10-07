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

/** The wrapper every one of these screens shares, announced as loading. */
export function SkeletonPage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}
