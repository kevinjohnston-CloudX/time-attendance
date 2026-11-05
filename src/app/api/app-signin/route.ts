import { auth } from "@/lib/auth";
import { APP_URL_SCHEME, isAppChallenge, issueAppSigninCode } from "@/lib/app-signin";

/**
 * Opened by the phone app in the phone's own browser (lib/app-signin.ts).
 * Signed in here: back to the app with a code. Not signed in: the sign-in
 * page, which returns here afterwards. Anyone may call it; it only ever hands
 * a code for the session the browser already holds, back to the app's scheme.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = url.searchParams.get("challenge");
  if (!isAppChallenge(challenge)) return new Response("Not found", { status: 404 });

  const session = await auth();
  if (!session?.user?.id || session.user.isActive === false) {
    const login = new URL("/login", url);
    login.searchParams.set("app", challenge);
    return Response.redirect(login, 303);
  }

  const code = issueAppSigninCode(session.user.id, challenge);
  if (!code) return new Response("Signing in from the app is not available right now.", { status: 503 });

  // Built by hand: a custom scheme is not something Response.redirect accepts.
  return new Response(null, {
    status: 303,
    headers: { Location: `${APP_URL_SCHEME}://signed-in?code=${encodeURIComponent(code)}`, "Cache-Control": "no-store" },
  });
}
