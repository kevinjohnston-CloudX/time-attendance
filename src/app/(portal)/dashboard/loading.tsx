import { Bar, SkeletonCard, SkeletonHeader, SkeletonPage, SkeletonRows } from "@/components/layout/page-skeleton";

/**
 * Dashboard while its cards are still being read.
 *
 * <p>Traces the real page inside the portal shell: the title and its line,
 * then the cards two up (one up when narrow), so nothing jumps when they
 * land and the sidebar never disappears.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading Dashboard">
      <SkeletonHeader action />
      <div className="grid gap-4 items-stretch [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(340px,44%)),1fr))]">
        <SkeletonCard>
          <Bar w={160} h={36} r={8} />
          <Bar w="45%" />
          <Bar w={96} h={32} r={8} />
        </SkeletonCard>
        <SkeletonCard>
          <div className="grid grid-cols-3 gap-3">
            <Bar w="80%" h={28} />
            <Bar w="80%" h={28} />
            <Bar w="80%" h={28} />
          </div>
          <Bar w="100%" h={6} r={999} />
          <SkeletonRows rows={2} />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonRows rows={4} />
        </SkeletonCard>
        <SkeletonCard>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(126px,1fr))]">
            {Array.from({ length: 4 }, (_, i) => (
              <Bar key={i} w="100%" h={58} r={8} />
            ))}
          </div>
          <SkeletonRows rows={4} h={10} />
        </SkeletonCard>
      </div>
    </SkeletonPage>
  );
}
