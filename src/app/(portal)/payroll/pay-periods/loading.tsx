/**
 * Pay Periods while a period is still being read.
 *
 * <p>The page's own skeleton rather than the app-wide spinner: a period with
 * hundreds of timesheets takes a few seconds, and a blank screen for that long
 * reads as broken. It traces the real layout from the page handoff: the period
 * list on the left, then the period's title and actions, the four totals, the
 * close checklist and the timesheets, so nothing jumps when the page lands.
 */

function Bar({ w, h = 12, round = false }: { w: string | number; h?: number; round?: boolean }) {
  return (
    <span
      className={`block flex-none animate-pulse ${round ? "rounded-full" : "rounded"}`}
      style={{ width: w, height: h, background: "var(--ta-skeleton)" }}
    />
  );
}

const panel = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" } as const;

export default function Loading() {
  return (
    <div className="flex flex-col items-stretch gap-[18px] lg:flex-row lg:items-start" aria-busy="true" aria-label="Loading pay periods">
      <div className="flex h-[480px] flex-col gap-3 p-[18px] lg:h-[calc(100dvh-7rem)] lg:min-w-[240px] lg:flex-[0_1_300px]" style={panel}>
        <div className="flex items-center justify-between">
          <Bar w={120} h={22} />
          <Bar w={80} h={14} />
        </div>
        <Bar w="100%" h={24} />
        <Bar w="100%" h={38} />
        <div className="flex items-center justify-between">
          <Bar w={110} h={32} />
          <Bar w={60} h={12} />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 pt-3">
            <Bar w={140} h={12} />
            <Bar w="85%" h={16} />
            <Bar w="100%" h={4} round />
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex flex-1 flex-col gap-2.5">
            <Bar w={300} h={32} />
            <Bar w={260} h={16} />
          </span>
          <span className="flex gap-2">
            <Bar w={120} h={32} />
            <Bar w={96} h={32} />
            <Bar w={100} h={32} />
          </span>
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3 px-5 py-[18px]" style={panel}>
              <Bar w={120} h={16} />
              <Bar w={90} h={34} />
              <Bar w="100%" h={5} round />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3 px-5 py-4" style={panel}>
          <Bar w={260} h={16} />
          <Bar w="70%" h={12} />
          <div className="grid gap-3 pt-2 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
            {Array.from({ length: 5 }).map((_, i) => (
              <Bar key={i} w="80%" h={28} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4" style={panel}>
          <Bar w={120} h={18} />
          <div className="flex gap-2">
            <Bar w={220} h={32} />
            <Bar w={130} h={32} />
            <Bar w={100} h={32} />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3.5 py-2">
              <Bar w={36} h={36} round />
              <span className="flex flex-1 flex-col gap-1.5">
                <Bar w="30%" h={14} />
                <Bar w="18%" h={12} />
              </span>
              <Bar w={70} h={20} round />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
