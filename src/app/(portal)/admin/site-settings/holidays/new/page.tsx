import { redirect } from "next/navigation";

/** An older address for adding a holiday, kept for links and bookmarks: it opens Company Setup's window. */
export default function NewHolidaysPage() {
  redirect("/admin/site-settings?tab=holidays&new=1");
}
