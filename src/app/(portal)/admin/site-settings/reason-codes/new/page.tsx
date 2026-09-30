import { redirect } from "next/navigation";

/** The classic design adds a reason code on a page of its own; this design opens Company Setup's window. */
export default function NewReasonCodesPage() {
  redirect("/admin/site-settings?tab=reason-codes&new=1");
}
