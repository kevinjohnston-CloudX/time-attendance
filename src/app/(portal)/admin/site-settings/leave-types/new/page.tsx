import { redirect } from "next/navigation";

/** An older address for adding a leave type, kept for links and bookmarks: it opens Company Setup's window. */
export default function NewLeaveTypesPage() {
  redirect("/admin/site-settings?tab=leave-types&new=1");
}
