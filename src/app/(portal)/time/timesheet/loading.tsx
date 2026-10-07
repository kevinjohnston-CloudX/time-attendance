import { Bar, SkeletonCard, SkeletonHeader, SkeletonPage, SkeletonRows } from "@/components/layout/page-skeleton";

/**
 * My Timesheet while the period is still being read.
 *
 * <p>Traces the real page inside the portal shell: the period picker, the
 * week's grid of days, then the period summary, so nothing jumps when they
 * land.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading My Timesheet">
      <SkeletonHeader action />
      <SkeletonCard title={false}>
        <div className="flex flex-wrap items-center gap-3">
          <Bar w={220} h={32} r={8} />
          <Bar w={180} h={28} r={8} />
        </div>
        <Bar w="100%" h={1} r={0} />
        <SkeletonRows rows={8} />
      </SkeletonCard>
      <SkeletonCard>
        <SkeletonRows rows={2} />
      </SkeletonCard>
    </SkeletonPage>
  );
}
