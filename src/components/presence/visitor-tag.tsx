import { Badge } from "@/components/ui";

/**
 * The mark that tells a visitor from an employee at a glance, wherever a
 * person is listed on Live Attendance: Scan log, Movements, People, the
 * visitor list and the person's details. One colour no status uses.
 */
export function VisitorTag() {
  return (
    <Badge tone="purple" size="sm">
      Visitor
    </Badge>
  );
}
