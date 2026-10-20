"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteDocument } from "@/actions/document.actions";
import { Button, ConfirmDialog } from "@/components/ui";

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
 *
 * <p>It asks in the app's own window (a bottom sheet on a phone) rather than
 * the browser's confirm box, and a refusal is said in that window instead of
 * a browser alert.
 */
export function DeleteDocumentButton({ documentId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteDocument({ documentId });
      if (res.success) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <Button
        hierarchy="tertiary"
        tone="error"
        size="sm"
        iconOnly
        onClick={() => { setError(null); setConfirming(true); }}
        disabled={isPending}
        title="Delete document"
        aria-label="Delete document"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      {confirming && (
        <ConfirmDialog
          title="Delete this document?"
          confirmLabel="Delete document"
          pendingLabel="Deleting…"
          pending={isPending}
          error={error}
          onConfirm={handleDelete}
          onCancel={() => setConfirming(false)}
        >
          The file is removed for good and the employee can no longer download it. This cannot be undone.
        </ConfirmDialog>
      )}
    </>
  );
}
