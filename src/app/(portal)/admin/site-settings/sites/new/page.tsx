import { redirect } from "next/navigation";

/** The classic design adds a site on a page of its own; this design opens Company Setup's window. */
export default function NewSitesPage() {
  redirect("/admin/site-settings?tab=sites&new=1");
}
