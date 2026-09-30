import { redirect } from "next/navigation";

/**
 * The classic design edits an agency on a page of its own; this design edits
 * it in Company Setup's window, so this address opens that window instead.
 * Company Setup checks who may see it.
 */
export default async function EditAgenciesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/site-settings?tab=agencies&edit=${encodeURIComponent(id)}`);
}
