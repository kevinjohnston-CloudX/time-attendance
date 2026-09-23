"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui";
import styles from "./on-site.module.css";

/**
 * A tablet photo laid over the initials already drawn in the same frame.
 *
 * <p>The server hands out a link without asking AWS whether the photo exists,
 * so a person with no photo gets a link that fails. When it does, the image
 * steps aside and the initials underneath show, with nothing moving. A new
 * link (the next signing window) gets a fresh try.
 */
export function Face({
  src,
  alt = "",
  onLoad,
}: {
  src: string | null | undefined;
  alt?: string;
  onLoad?: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a signed S3 link, not an asset next/image can optimise
    <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={onLoad} onError={() => setFailed(src)} />
  );
}

/**
 * A Face that opens large when clicked, once there is a photo to open: a
 * person showing initials has nothing to enlarge, so there is nothing to
 * click. Sits over the whole frame, with a small mark in the corner on hover
 * so it reads as "make this bigger" rather than "open this person".
 */
export function ZoomableFace({
  src,
  name,
  onZoom,
}: {
  src: string | null | undefined;
  name: string;
  onZoom?: (src: string) => void;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <>
      <Face src={src} onLoad={() => setLoaded(src ?? null)} />
      {src && loaded === src && onZoom && (
        <button
          type="button"
          className={styles.zoom}
          aria-label={`View a larger photo of ${name}`}
          title="View larger photo"
          onClick={(e) => {
            e.stopPropagation();
            onZoom(src);
          }}
        >
          <span className={styles.zoomMark} aria-hidden="true">
            <Maximize2 className="h-3.5 w-3.5" />
          </span>
        </button>
      )}
    </>
  );
}

/**
 * The photo, large, over everything, with who it is underneath. Closes on
 * Escape, on the backdrop and on the close button, and gives focus back to
 * the face it was opened from. Escape is caught before the person panel
 * hears it, so closing the photo leaves the panel open.
 */
export function PhotoViewer({
  src,
  name,
  detail,
  onClose,
}: {
  src: string;
  name: string;
  detail: string;
  onClose: () => void;
}) {
  const closeRef = useRef(onClose);
  const buttonRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    buttonRef.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className={styles.viewer} role="dialog" aria-modal="true" aria-label={`Photo of ${name}`} onClick={onClose}>
      <figure className={styles.viewerFrame} onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed S3 link */}
        <img src={src} alt={`Photo of ${name}`} className={styles.viewerImg} />
        <figcaption className={styles.viewerCaption}>
          <span className="flex min-w-0 flex-col">
            <span className="truncate" style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>
              {name}
            </span>
            <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              {detail}
            </span>
          </span>
          <div ref={buttonRef}>
            <Button hierarchy="tertiary" size="sm" iconOnly aria-label="Close photo" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </figcaption>
      </figure>
    </div>
  );
}
