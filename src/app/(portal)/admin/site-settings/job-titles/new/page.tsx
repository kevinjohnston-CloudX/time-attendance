import { redirect } from "next/navigation";

/** An older address for adding a job title, kept for links and bookmarks: it opens Company Setup's window. */
export default function NewJobTitlesPage() {
  redirect("/admin/site-settings?tab=job-titles&new=1");
}
