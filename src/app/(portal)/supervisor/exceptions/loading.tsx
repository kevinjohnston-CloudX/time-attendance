/**
 * Exceptions while the queue is still being counted.
 *
 * <p>The page's own skeleton rather than the app-wide spinner, because this
 * route sits inside the portal shell: replacing the whole window throws away
 * the sidebar and header the person was already looking at, and makes a two
 * second wait feel like a page change.
 *
 * <p>It traces the real layout, rail and all, so nothing jumps when the rows
 * land.
 */

function Bar({ w, h = 12 }: { w: string; h?: number }) {
  return (
    <span
      className="block animate-pulse rounded"
      style={{ width: w, height: h, background: "var(--ta-skeleton)" }}
    />
  );
}

function CardSkeleton() {
  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        border: "1px solid var(--stroke-secondary)",
        borderLeft: "3px solid var(--ta-skeleton)",
        borderRadius: "var(--radius-l)",
        background: "var(--surface-card)",
      }}
    >
      <div className="flex flex-col gap-2 px-4 pb-3.5 pt-3.5">
        <Bar w="38%" h={14} />
        <Bar w="52%" />
        <Bar w="72%" h={14} />
      </div>
      <div
        className="grid grid-cols-2"
        style={{
          gap: 1,
          background: "var(--stroke-divider)",
          borderTop: "1px solid var(--stroke-divider)",
          borderBottom: "1px solid var(--stroke-divider)",
        }}
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-1.5 px-4 py-2.5"
            style={{ background: "var(--surface-card)" }}
          >
            <Bar w="60px" h={9} />
            <Bar w="96px" />
          </div>
        ))}
      </div>
      <div className="flex gap-2 px-4 py-3">
        <Bar w="132px" h={28} />
        <Bar w="126px" h={28} />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading exceptions">
      <div className="flex flex-col gap-2">
        <Bar w="190px" h={28} />
        <Bar w="330px" />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Bar w="260px" h={30} />
        <Bar w="86px" h={28} />
        <Bar w="120px" h={28} />
        <Bar w="82px" h={28} />
        <Bar w="74px" h={28} />
        <Bar w="112px" h={28} />
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div
          className="flex flex-[1_1_216px] flex-col overflow-hidden"
          style={{
            maxWidth: 256,
            border: "1px solid var(--stroke-secondary)",
            borderRadius: "var(--radius-l)",
            background: "var(--surface-card)",
          }}
        >
          <div className="px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
            <Bar w="92px" h={10} />
          </div>
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex flex-col gap-1.5 px-3.5 py-2.5"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <Bar w="74%" h={13} />
              <Bar w="52%" h={10} />
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-[4_1_380px] flex-col gap-2.5">
          <Bar w="210px" h={16} />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </div>
  );
}
