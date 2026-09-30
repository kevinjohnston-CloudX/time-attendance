import { redirect } from "next/navigation";

/**
 * The classic design edits a pay type on a page of its own; this design edits
 * it in Company Setup's window, so this address opens that window instead.
 * Company Setup checks who may see it.
 */
export default async function EditPayTypesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/site-settings?tab=pay-types&edit=${encodeURIComponent(id)}`);
}
