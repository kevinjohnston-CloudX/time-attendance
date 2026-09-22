/**
 * Team Leave while its three queues are still being counted.
 *
 * <p>The page's own skeleton rather than the app-wide spinner, because this
 * route sits inside the portal shell: replacing the whole window with a
 * spinner throws away the sidebar and the header the person was already
 * looking at, and makes a two second wait feel like a page change.
 *
 * <p>It traces the real layout, so nothing jumps when the data lands.
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
      className="flex items-start gap-3 px-4 py-3.5"
      style={{
        border: "1px solid var(--stroke-secondary)",
        borderRadius: 10,
        background: "var(--surface-card)",
      }}
    >
      <span
        className="animate-pulse"
        style={{
          width: 34,
          height: 34,
          flex: "none",
          borderRadius: 999,
          background: "var(--ta-skeleton)",
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Bar w="42%" h={14} />
        <Bar w="66%" />
        <Bar w="54%" />
        <div className="mt-1.5 flex gap-2">
          <Bar w="84px" h={28} />
          <Bar w="76px" h={28} />
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading team leave">
      <div className="flex flex-col gap-2">
        <Bar w="220px" h={28} />
        <Bar w="320px" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Bar w="260px" h={30} />
        <Bar w="220px" h={30} />
        <Bar w="90px" h={28} />
        <Bar w="120px" h={28} />
      </div>

      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(360px,42%)),1fr))]">
        <div className="flex flex-col gap-2.5">
          <Bar w="180px" h={16} />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>

        <div
          className="flex flex-col gap-3 p-4"
          style={{
            border: "1px solid var(--stroke-secondary)",
            borderRadius: 12,
            background: "var(--surface-card)",
          }}
        >
          <Bar w="140px" h={16} />
          <Bar w="100%" h={44} />
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }, (_, i) => (
              <Bar key={i} w="100%" h={62} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
