/**
 * Team Punch History while the punches are still being read.
 *
 * <p>The page's own skeleton rather than the app-wide spinner, so the sidebar
 * and header stay where they were and a short wait does not feel like a page
 * change. It traces the real layout, the people pane and the punch panel with
 * its first day, so nothing jumps when the rows land.
 */

function Bar({ w, h = 12, round = false }: { w: string | number; h?: number; round?: boolean }) {
  return (
    <span
      className={`block flex-none animate-pulse ${round ? "rounded-full" : "rounded"}`}
      style={{ width: w, height: h, background: "var(--ta-skeleton)" }}
    />
  );
}

const panel = {
  border: "1px solid var(--stroke-secondary)",
  background: "var(--surface-card)",
} as const;

export default function Loading() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading team punch history">
      <div className="flex flex-col gap-3.5 pb-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Bar w={290} h={30} />
          <Bar w={300} />
          <span className="ml-auto">
            <Bar w={64} h={28} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Bar w={210} h={32} />
          <Bar w={64} h={32} />
          <Bar w={250} h={32} />
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-3.5">
        <div
          className="flex min-w-0 flex-[1_1_240px] flex-col overflow-hidden"
          style={{ ...panel, maxWidth: 300, borderRadius: "var(--radius-m)" }}
        >
          <div className="flex items-center justify-between px-3.5 py-3" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
            <Bar w={80} h={13} />
            <Bar w={18} h={11} />
          </div>
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 px-3.5 py-2.5"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <Bar w={32} h={32} round />
              <span className="flex flex-1 flex-col gap-1.5">
                <Bar w="70%" h={13} />
                <Bar w="46%" h={10} />
              </span>
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-[3_1_480px] flex-col overflow-hidden" style={{ ...panel, borderRadius: "var(--radius-m)" }}>
          <div className="flex flex-wrap items-center gap-3.5 px-[18px] py-4" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
            <Bar w={44} h={44} round />
            <span className="flex flex-[1_1_200px] flex-col gap-2">
              <Bar w={150} h={16} />
              <Bar w={220} h={11} />
            </span>
            <span className="flex gap-[22px]">
              {[0, 1, 2].map((i) => (
                <span key={i} className="flex flex-col items-end gap-1.5">
                  <Bar w={44} h={18} />
                  <Bar w={70} h={10} />
                </span>
              ))}
            </span>
          </div>
          <div className="flex gap-3 px-[18px] py-2.5" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
            {[88, 64, 64, 52, 56].map((w, i) => (
              <span key={i} className="flex-1">
                <Bar w={w} h={9} />
              </span>
            ))}
          </div>
          <div className="flex min-h-10 items-center px-[18px] py-2" style={{ background: "var(--surface-tertiary)", borderBottom: "1px solid var(--stroke-divider)" }}>
            <Bar w={90} h={13} />
          </div>
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex min-h-[46px] items-center gap-3 px-[18px] py-2"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              {[110, 84, 64, 44, 76].map((w, j) => (
                <span key={j} className="flex-1">
                  <Bar w={w} h={12} />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
