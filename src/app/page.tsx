import { redirect } from "next/navigation";
import { SESSION_ENDED_HREF } from "@/lib/auth.config";
import { auth } from "@/lib/auth";

export default async function RootPage() {
  const session = await auth();
  if (session) {
    redirect("/dashboard");
  }
  redirect(SESSION_ENDED_HREF);
}
