"use client";

import { useState } from "react";

/**
 * A tablet photo laid over the initials already drawn in the same frame.
 *
 * <p>The server hands out a link without asking AWS whether the photo exists,
 * so a person with no photo gets a link that fails. When it does, the image
 * steps aside and the initials underneath show, with nothing moving. A new
 * link (the next signing window) gets a fresh try.
 */
export function Face({ src, alt = "" }: { src: string | null | undefined; alt?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a signed S3 link, not an asset next/image can optimise
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(src)} />
  );
}
