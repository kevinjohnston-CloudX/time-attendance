import { redirect } from "next/navigation";

/**
 * An older address for editing a holiday, kept for links and bookmarks: it opens
 * Company Setup's window on that record.
 * Company Setup checks who may see it.
 */
export default async function EditHolidaysPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/site-settings?tab=holidays&edit=${encodeURIComponent(id)}`);
}
