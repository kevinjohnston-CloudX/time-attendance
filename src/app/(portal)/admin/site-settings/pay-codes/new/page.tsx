import { redirect } from "next/navigation";

/** An older address for adding a pay code, kept for links and bookmarks: it opens Company Setup's window. */
export default function NewPayCodesPage() {
  redirect("/admin/site-settings?tab=pay-codes&new=1");
}
