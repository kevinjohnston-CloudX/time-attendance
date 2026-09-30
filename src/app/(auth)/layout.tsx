// The new design's styles, loaded by its own layouts rather than the shared
// root, so the classic design never gets them.
import "@/app/globals.css";
/**
 * The auth shell.
 *
 * <p>Deliberately thin. The design gives sign-in and the password screens two
 * different frames — sign-in is a split screen with the brand panel down the
 * right, the password screens are a single centred column on the page surface
 * — so the frame belongs to the page and this only supplies the full height
 * and the background under it.
 *
 * <p>It used to own the split, which forced /forgot-password and
 * /setup-password into a two-column layout they were never drawn in, and put
 * a decorative panel next to a 380px form.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--surface-page)", color: "var(--text-primary)" }}
    >
      {children}
    </div>
  );
}
