import { redirect } from "next/navigation";

/** An older address for adding a department, kept for links and bookmarks: it opens Company Setup's window. */
export default function NewDepartmentsPage() {
  redirect("/admin/site-settings?tab=departments&new=1");
}
