import { Bar, SkeletonCard, SkeletonHeader, SkeletonPage } from "@/components/layout/page-skeleton";

/**
 * An employee's record while it is still being read.
 *
 * <p>Traces the real page inside the portal shell: the profile card on the
 * left, the record's sections on the right, so nothing jumps when they land.
 */
function Fields() {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Bar w="35%" h={10} />
          <Bar w="70%" h={14} />
        </div>
      ))}
    </div>
  );
}

export default function Loading() {
  return (
    <SkeletonPage label="Loading employee">
      <SkeletonHeader action />
      <div className="grid gap-4 items-start [grid-template-columns:minmax(0,1fr)] md:[grid-template-columns:280px_minmax(0,1fr)]">
        <SkeletonCard title={false}>
          <div className="flex flex-col items-center gap-3 py-2">
            <Bar w={96} h={96} r={16} />
            <Bar w={70} h={20} r={999} />
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex justify-between gap-3">
              <Bar w="40%" h={10} />
              <Bar w="35%" h={10} />
            </div>
          ))}
        </SkeletonCard>
        <div className="flex flex-col gap-4">
          <SkeletonCard>
            <Fields />
          </SkeletonCard>
          <SkeletonCard>
            <Fields />
          </SkeletonCard>
        </div>
      </div>
    </SkeletonPage>
  );
}
