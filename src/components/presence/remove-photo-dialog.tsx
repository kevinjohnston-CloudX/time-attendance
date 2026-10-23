"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui";
import { removeEmployeePhoto } from "@/actions/presence.actions";
import styles from "./on-site.module.css";

/**
 * Remove photo, asked first: the photo being removed, whose it is, and what
 * happens next (initials until their next scan at a time clock, which takes a
 * new one). Cancel has the focus, so an Enter out of habit removes nothing.
 *
 * <p>The server checks the permission, the building and whose file it is
 * again; this only draws the question. When nothing could be removed (the
 * photo is filed under a badge someone else also uses, or there is none on
 * file any more) the window stays open and says why.
 */
export function RemovePhotoDialog({
  siteId,
  employeeId,
  name,
  photoSrc,
  onClose,
  onRemoved,
}: {
  siteId: string;
  employeeId: string;
  name: string;
  photoSrc: string | null | undefined;
  onClose: () => void;
  /** The photo is gone: draw their initials everywhere on the page. */
  onRemoved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    const res = await removeEmployeePhoto({ siteId, employeeId });
    setPending(false);
    if (!res.success) return setError(res.error);
    if (res.data.removed > 0) return onRemoved();
    setError(
      res.data.kept > 0
        ? "This photo is filed under a badge another employee also uses, so it was left in place. Ask an admin to update it instead."
        : "There is no photo on file for them any more. Their next scan at a time clock takes one.",
    );
  }

  return (
    <ConfirmDialog
      title="Remove photo?"
      confirmLabel="Remove photo"
      pendingLabel="Removing…"
      tone="danger"
      pending={pending}
      error={error}
      onConfirm={remove}
      onCancel={onClose}
    >
      <span className="flex flex-col items-center gap-3">
        {photoSrc && (
          // eslint-disable-next-line @next/next/no-img-element -- a signed S3 link, not an app asset
          <img src={photoSrc} alt={`Current photo of ${name}`} className={styles.rpPhoto} />
        )}
        <span>
          {name}&apos;s photo is removed everywhere it shows. Their next scan at a time clock takes a new one.
        </span>
      </span>
    </ConfirmDialog>
  );
}
