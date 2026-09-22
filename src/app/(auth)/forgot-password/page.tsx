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
      sub="Password resets are issued by an administrator — there is no self-serve reset here."
      note="Kiosk-only users have no portal password at all: your badge is what identifies you at the timeclock."
    >
      <Banner
        tone="info"
        body="Ask your supervisor or the HR team. They can set you a new password, or send you a setup link that works for 24 hours."
      />
    </AuthScreen>
  );
}
