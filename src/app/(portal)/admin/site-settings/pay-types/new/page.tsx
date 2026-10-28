import { redirect } from "next/navigation";

/** An older address for adding a pay type, kept for links and bookmarks: it opens Company Setup's window. */
export default function NewPayTypesPage() {
  redirect("/admin/site-settings?tab=pay-types&new=1");
}
