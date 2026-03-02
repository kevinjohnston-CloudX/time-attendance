"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteDocument } from "@/actions/document.actions";

interface Props {
  documentId: string;
}

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
    <button
      onClick={handleDelete}
      disabled={isPending}
      title="Delete document"
      className="text-red-400 hover:text-red-600 disabled:opacity-40 dark:text-red-500 dark:hover:text-red-400"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
