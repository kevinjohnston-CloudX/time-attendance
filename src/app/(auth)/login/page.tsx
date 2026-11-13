import { microsoftSignInOffered } from "@/lib/microsoft-signin";
import { LoginForm } from "./login-form";

/**
 * Sign in. Drawn by LoginForm; this only tells it whether Microsoft sign in
 * is set up (its keys are present), so the button is in the page from the
 * first paint or not at all, never popping in after.
 */
export default function LoginPage() {
  return <LoginForm microsoft={microsoftSignInOffered()} />;
}
