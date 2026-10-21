import { Banner } from "@/components/ui";
import { AuthScreen } from "../auth-screen";

/**
 * There is no self-serve reset on this deployment.
 *
 * <p>The design draws this screen with a Work Email field and a "Send Reset
 * Link" button, but the only thing that issues a reset token here is
 * `sendPasswordInvite`, and that refuses anyone who is not an HR, payroll or
 * system admin. A field and a button that cannot post anywhere would leave
 * someone waiting on an email that is never sent, so this says who to ask
 * instead.
 */
export default function ForgotPasswordPage() {
  return (
    <AuthScreen
      title="Forgot password"
      sub="Passwords are reset by an administrator."
      note="If you only use the time clock, you do not need a password. Your badge identifies you there."
    >
      <Banner
        tone="info"
        body="Ask the HR or payroll team. They can give you a temporary password, and CloudTime asks you to choose your own the next time you sign in."
      />
    </AuthScreen>
  );
}
