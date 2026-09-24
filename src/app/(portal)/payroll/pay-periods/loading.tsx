/**
 * Pay Periods while a period is still being read.
 *
 * <p>The page's own skeleton rather than the app-wide spinner: a period with
 * hundreds of timesheets takes a few seconds, and a blank screen for that long
 * reads as broken. It traces the real layout: the page header, the period
 * list card on the left, and the approvals, checklist, hours and timesheets
 * on the right, so nothing jumps when the page lands.
 */

function Bar({ w, h = 12, round = false }: { w: string | number; h?: number; round?: boolean }) {
  return (
    <span
      className={`block flex-none animate-pulse ${round ? "rounded-full" : "rounded"}`}
      style={{ width: w, height: h, background: "var(--ta-skeleton)" }}
    />
  );
}

const card = {
  background: "var(--surface-card)",
  borderRadius: "var(--radius-l)",
  boxShadow: "var(--shadow-card)",
} as const;

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading pay periods">
      <div className="flex flex-wrap items-end gap-4 pb-1">
        <span className="flex flex-1 flex-col gap-2">
          <Bar w={220} h={30} />
          <Bar w={300} h={14} />
        </span>
        <Bar w={84} h={36} />
        <Bar w={84} h={36} />
        <Bar w={96} h={36} />
        <Bar w={104} h={36} />
      </div>

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <aside className="flex w-full flex-col gap-3 p-4 lg:w-80 lg:flex-none" style={card}>
          <div className="flex items-center justify-between">
            <Bar w={70} h={16} />
            <Bar w={20} h={12} />
          </div>
          <div className="flex items-center gap-1.5">
            <Bar w={96} h={28} round />
            <Bar w={80} h={28} round />
          </div>
          <Bar w="100%" h={34} />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 py-1.5">
              <Bar w={150} h={14} />
              <Bar w="100%" h={4} />
            </div>
          ))}
        </aside>

        <div className="@container flex w-full min-w-0 flex-1 flex-col gap-4">
          <span className="flex flex-col gap-2">
            <Bar w={280} h={26} />
            <Bar w={240} h={12} />
          </span>

          <div className="grid gap-4 @4xl:grid-cols-2">
            {[0, 1].map((k) => (
              <div key={k} className="flex flex-col gap-3 p-4" style={card}>
                <Bar w={120} h={16} />
                <Bar w={200} h={12} />
                <Bar w={k === 0 ? 90 : "100%"} h={k === 0 ? 36 : 12} />
                {Array.from({ length: 5 }, (_, i) => (
                  <Bar key={i} w="100%" h={18} />
                ))}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 p-4" style={card}>
            <Bar w={80} h={16} />
            <div className="flex gap-6">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="flex flex-1 flex-col gap-2">
                  <Bar w={70} h={10} />
                  <Bar w={90} h={22} />
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 p-4" style={card}>
            <Bar w={110} h={16} />
            <div className="flex gap-2.5">
              <Bar w={240} h={32} />
              <Bar w={70} h={28} round />
              <Bar w={110} h={28} round />
              <Bar w={70} h={28} round />
            </div>
            {Array.from({ length: 6 }, (_, i) => (
              <Bar key={i} w="100%" h={28} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
