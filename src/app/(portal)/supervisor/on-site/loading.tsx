/**
 * On Site while the first snapshot is being counted.
 *
 * <p>Traces the real layout, headcount and tiles, inside the portal shell, so
 * nothing jumps when the faces land and the sidebar never disappears.
 */

function Bar({ w, h = 12, r = 6 }: { w: string | number; h?: number; r?: number }) {
  return (
    <span
      className="block animate-pulse"
      style={{ width: w, height: h, borderRadius: r, background: "var(--ta-skeleton)" }}
    />
  );
}

const panel = {
  background: "var(--surface-card)",
  borderRadius: "var(--radius-l)",
  boxShadow: "var(--shadow-card)",
} as const;

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading who is on site">
      <div className="flex flex-col gap-2">
        <Bar w={260} h={30} />
        <Bar w={200} />
      </div>

      <div className="flex flex-col gap-4 p-5" style={panel}>
        <Bar w={240} h={48} />
        <Bar w="100%" h={10} r={999} />
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(128px,1fr))]">
          {Array.from({ length: 7 }, (_, i) => (
            <Bar key={i} w="100%" h={58} r={8} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Bar w={260} h={32} r={8} />
        <Bar w={112} h={28} r={999} />
        <Bar w={82} h={28} r={999} />
      </div>

      <div style={panel}>
        <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
          <Bar w={180} h={18} />
        </div>
        <div className="grid gap-3 p-4 [grid-template-columns:repeat(auto-fill,minmax(152px,1fr))]">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="flex flex-col gap-2">
              <Bar w="100%" h={160} r={12} />
              <Bar w="70%" />
              <Bar w="50%" h={10} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
