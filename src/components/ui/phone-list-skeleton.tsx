/**
 * A list screen while it loads, in a phone's shape: the large title, the
 * search line, then rows with a face and two lines. A phone's list screens
 * all open this way, so a route's loading.tsx draws it beside its own
 * computer skeleton and nothing jumps when the rows land.
 */

function Bar({ w, h = 12, round = 6 }: { w: string | number; h?: number; round?: number }) {
  return (
    <span
      className="block flex-none animate-pulse"
      style={{ width: w, height: h, borderRadius: round, background: "var(--ta-skeleton)" }}
    />
  );
}

export function PhoneListSkeleton({ rows = 8, faces = true }: { rows?: number; faces?: boolean }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="flex flex-col gap-2.5 pt-1">
        <Bar w="58%" h={30} round={8} />
        <Bar w="44%" h={14} />
      </div>
      <div
        className="flex items-center gap-2 p-1.5"
        style={{ borderRadius: 14, background: "var(--surface-card)", boxShadow: "var(--ta-toolbar-shadow)" }}
      >
        <span className="flex-1 px-2">
          <Bar w="50%" h={14} />
        </span>
        <Bar w={92} h={44} round={12} />
      </div>
      <div
        className="flex flex-col overflow-hidden"
        style={{ borderRadius: 14, background: "var(--surface-card)", boxShadow: "var(--ta-raised)" }}
      >
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4"
            style={{ minHeight: 68, borderTop: i ? "1px solid var(--stroke-divider)" : undefined }}
          >
            {faces && <Bar w={40} h={40} round={20} />}
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <Bar w={`${58 - (i % 3) * 9}%`} h={14} />
              <Bar w={`${40 - (i % 2) * 8}%`} h={11} />
            </span>
            <Bar w={36} h={20} round={10} />
          </div>
        ))}
      </div>
    </div>
  );
}
