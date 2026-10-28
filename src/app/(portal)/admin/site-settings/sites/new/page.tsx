import { redirect } from "next/navigation";

/** An older address for adding a site, kept for links and bookmarks: it opens Company Setup's window. */
export default function NewSitesPage() {
  redirect("/admin/site-settings?tab=sites&new=1");
}
