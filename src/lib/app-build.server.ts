import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The build this server is serving (see lib/app-build.ts). On a laptop it can
 * be set by hand, to see the new version banner without a deploy: write a
 * build key into _ops/dev/app-build.txt (development only, read each time).
 */
export async function servedBuild(): Promise<string> {
  const build = process.env.NEXT_PUBLIC_APP_BUILD ?? "";
  if (process.env.NODE_ENV !== "development") return build;
  const typed = await readFile(path.join(process.cwd(), "_ops/dev/app-build.txt"), "utf8").catch(() => "");
  return typed.trim() || build;
}
