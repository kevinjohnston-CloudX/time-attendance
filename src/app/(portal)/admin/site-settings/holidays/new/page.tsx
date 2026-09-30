import { redirect } from "next/navigation";

/** The classic design adds a holiday on a page of its own; this design opens Company Setup's window. */
export default function NewHolidaysPage() {
  redirect("/admin/site-settings?tab=holidays&new=1");
}
