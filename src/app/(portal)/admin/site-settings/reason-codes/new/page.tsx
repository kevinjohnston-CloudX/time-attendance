import { redirect } from "next/navigation";

/** An older address for adding a reason code, kept for links and bookmarks: it opens Company Setup's window. */
export default function NewReasonCodesPage() {
  redirect("/admin/site-settings?tab=reason-codes&new=1");
}
