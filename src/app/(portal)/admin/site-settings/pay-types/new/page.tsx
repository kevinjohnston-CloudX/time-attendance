import { redirect } from "next/navigation";

/** The classic design adds a pay type on a page of its own; this design opens Company Setup's window. */
export default function NewPayTypesPage() {
  redirect("/admin/site-settings?tab=pay-types&new=1");
}
