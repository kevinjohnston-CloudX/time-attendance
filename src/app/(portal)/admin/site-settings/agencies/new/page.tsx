import { redirect } from "next/navigation";

/** The classic design adds an agency on a page of its own; this design opens Company Setup's window. */
export default function NewAgenciesPage() {
  redirect("/admin/site-settings?tab=agencies&new=1");
}
