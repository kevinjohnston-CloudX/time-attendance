import { Bar, SkeletonCard, SkeletonHeader, SkeletonPage, SkeletonRows } from "@/components/layout/page-skeleton";

/**
 * Punch Clock while today's punches are still being read.
 *
 * <p>Traces the real page inside the portal shell: the clock card, then the
 * cards two up, so nothing jumps when they land.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading Punch Clock">
      <SkeletonHeader />
      <SkeletonCard title={false}>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-2">
            <Bar w={90} h={22} r={999} />
            <Bar w={280} h={44} r={8} />
            <Bar w={240} />
          </div>
          <span className="flex-1" />
          <Bar w={200} h={40} r={8} />
        </div>
      </SkeletonCard>
      <div className="grid gap-4 items-stretch [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(380px,46%)),1fr))]">
        <SkeletonCard>
          <SkeletonRows rows={4} />
        </SkeletonCard>
        <SkeletonCard>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }, (_, i) => (
              <Bar key={i} w="100%" h={104} r={4} />
            ))}
          </div>
        </SkeletonCard>
      </div>
    </SkeletonPage>
  );
}
