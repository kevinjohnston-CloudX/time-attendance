"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteDocument } from "@/actions/document.actions";
import { Button } from "@/components/ui";

interface Props {
  documentId: string;
}

/**
 * Delete, on a document row.
 *
 * <p>The kit's error tone rather than a hand-written red: the old pair of raw
 * ramp steps gave this one control a different red from every other
 * destructive action, and its dark-mode step was lighter than its light-mode
 * one, so the button got louder when the lights went out.
 */
export function DeleteDocumentButton({ documentId }: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    startTransition(async () => {
      const res = await deleteDocument({ documentId });
      if (res.success) {
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  }

  return (
    <Button
      hierarchy="tertiary"
      tone="error"
      size="sm"
      iconOnly
      onClick={handleDelete}
      disabled={isPending}
      title="Delete document"
      aria-label="Delete document"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
