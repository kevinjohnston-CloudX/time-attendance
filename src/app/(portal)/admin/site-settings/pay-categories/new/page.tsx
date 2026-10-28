import { redirect } from "next/navigation";

/** An older address for adding a pay category, kept for links and bookmarks: it opens Company Setup's window. */
export default function NewPayCategoriesPage() {
  redirect("/admin/site-settings?tab=pay-categories&new=1");
}
