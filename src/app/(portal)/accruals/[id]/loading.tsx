import { Bar, SkeletonCard, SkeletonHeader, SkeletonPage, SkeletonRows } from "@/components/layout/page-skeleton";

/**
 * An employee's accruals while their balances are still being read.
 *
 * <p>Traces the real page inside the portal shell: their policies, the date
 * range, then the balances and the ledger, so nothing jumps when they land.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading accruals">
      <SkeletonHeader action />
      <SkeletonCard>
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
          {Array.from({ length: 3 }, (_, i) => (
            <Bar key={i} w="100%" h={48} r={8} />
          ))}
        </div>
      </SkeletonCard>
      <SkeletonCard>
        <div className="flex gap-3">
          <Bar w={160} h={32} r={8} />
          <Bar w={160} h={32} r={8} />
        </div>
      </SkeletonCard>
      <SkeletonCard>
        <SkeletonRows rows={4} />
      </SkeletonCard>
    </SkeletonPage>
  );
}
