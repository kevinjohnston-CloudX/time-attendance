import { redirect } from "next/navigation";

// Timecards have no approval steps, so there is no queue to show here.
// Kept as a redirect so old links and bookmarks still land somewhere useful.
export default function TeamTimesheetsPage() {
  redirect("/payroll/timecards");
}
