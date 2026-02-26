import type { WorkSegment } from "@prisma/client";
import { format } from "date-fns";
import { formatMinutes } from "@/lib/utils/duration";

const SEGMENT_COLORS = {
  WORK: "bg-green-500",
  MEAL: "bg-amber-400",
  BREAK: "bg-blue-400",
};

// Timeline shows 5am – midnight (19 hours = 1140 min)
const TIMELINE_START_HOUR = 5;
const TIMELINE_DURATION_MIN = 19 * 60;

function toMinuteOffset(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() - TIMELINE_START_HOUR * 60;
}

interface SegmentTimelineProps {
  segments: WorkSegment[];
  date: Date;
}

export function SegmentTimeline({ segments, date }: SegmentTimelineProps) {
  const dayStart = new Date(date);
  dayStart.setHours(TIMELINE_START_HOUR, 0, 0, 0);

  return (
    <div className="relative h-6 w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
      {segments.map((seg) => {
        const startMin = Math.max(0, toMinuteOffset(seg.startTime));
        const endMin = Math.min(
          TIMELINE_DURATION_MIN,
          toMinuteOffset(seg.endTime)
        );
        if (endMin <= startMin) return null;

        const left = (startMin / TIMELINE_DURATION_MIN) * 100;
        const width = ((endMin - startMin) / TIMELINE_DURATION_MIN) * 100;

        return (
          <div
            key={seg.id}
            title={`${seg.segmentType} ${format(seg.startTime, "h:mm a")}–${format(seg.endTime, "h:mm a")} (${formatMinutes(seg.durationMinutes)})`}
            className={`absolute top-0 h-full ${SEGMENT_COLORS[seg.segmentType]} opacity-80`}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        );
      })}
    </div>
  );
}
