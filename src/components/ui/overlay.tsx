"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { createPortal } from "react-dom";

const noSubscribe = () => () => {};

/**
 * The backdrop every pop up sits on, drawn at the end of <body>.
 *
 * A pop up rendered where its button lives inherits that spot's layer. Inside
 * a page's pinned bar (z-20) it can never rise above the app's top bar (z-30),
 * whatever its own z-index, so the top bar shows through the dimmed backdrop.
 * At the end of <body> it competes with the app frame directly. React events
 * and context still reach it as if it sat where it is written.
 *
 * Takes a div's props: the layout, layer and background the backdrop needs.
 * `fixed inset-0` is added here. The eslint rule in eslint.config.mjs sends
 * every new backdrop through this component.
 */
export function Overlay({ className = "", ...rest }: ComponentProps<"div">) {
  // False while rendering on the server and during hydration, true after.
  const onClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!onClient) return null;
  return createPortal(<div {...rest} className={`fixed inset-0 ${className}`} />, document.body);
}
