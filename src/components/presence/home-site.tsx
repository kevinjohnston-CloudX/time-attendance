import { Badge } from "@/components/ui/badge";

/**
 * The quiet tag for somebody who scanned at this building while their record
 * names another site. The site name is whatever the record says, so it is
 * cut to fit and spelled out in full on hover.
 */
export function HomeSiteBadge({ site, size = "sm" }: { site: string | null; size?: "sm" | "md" }) {
  if (!site) return null;
  return (
    <span className="inline-flex min-w-0 max-w-[180px]" title={`Home site: ${site}`}>
      <Badge tone="neutral" size={size} style={{ maxWidth: "100%" }}>
        <span className="min-w-0 truncate">From {site}</span>
      </Badge>
    </span>
  );
}
