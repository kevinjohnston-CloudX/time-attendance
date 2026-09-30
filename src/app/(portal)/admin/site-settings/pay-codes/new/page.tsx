import { redirect } from "next/navigation";

/** The classic design adds a pay code on a page of its own; this design opens Company Setup's window. */
export default function NewPayCodesPage() {
  redirect("/admin/site-settings?tab=pay-codes&new=1");
}
