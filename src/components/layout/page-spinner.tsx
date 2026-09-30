/**
 * A full page spinner that needs no style sheet, for the screens shared by
 * both designs (the first paint, the not found screen while it decides).
 *
 * <p>Whatever those screens import is attached to every page of both
 * designs, and the new design's sheet on a classic page recolors it and
 * breaks its dark mode. So this is inline styles alone: the new design's
 * tokens when they are on the page, the browser's own light or dark canvas
 * when not, and an SVG that spins without any CSS.
 */
export function PageSpinner() {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-page, Canvas)",
        color: "var(--fill-accent, CanvasText)",
      }}
    >
      <svg width="32" height="32" viewBox="0 0 32 32" role="status" aria-label="Loading">
        <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M16 3a13 13 0 0 1 13 13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 16 16"
            to="360 16 16"
            dur="0.8s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
    </div>
  );
}
