import { redirect } from "next/navigation";

/** An older address for adding an agency, kept for links and bookmarks: it opens Company Setup's window. */
export default function NewAgenciesPage() {
  redirect("/admin/site-settings?tab=agencies&new=1");
}
