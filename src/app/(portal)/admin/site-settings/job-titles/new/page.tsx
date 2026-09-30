import { redirect } from "next/navigation";

/** The classic design adds a job title on a page of its own; this design opens Company Setup's window. */
export default function NewJobTitlesPage() {
  redirect("/admin/site-settings?tab=job-titles&new=1");
}
