// After `next build` (npm runs it as postbuild): one fingerprint per page of
// this build, so an open tab can tell whether the page it is sitting on
// changed in a newer build (src/lib/app-build.ts, the new version banner).
//
// A page's fingerprint covers everything a refresh would load differently:
// the names of its browser files (content hashed by the build, so a name
// changes exactly when the file does) and the contents of its server files
// (named by place, not content, so they are read). Measured on Next 16.4 on
// 2026-11-11: two builds of the same code give identical fingerprints on all
// 96 pages, and a change to one page's button or heading changes that page's
// fingerprint and no other.
//
// Written to .next/static/cloudtime-build/<build>.json, served as a static
// file beside the build's own scripts. The build key is the same expression
// next.config.ts bakes into the app as NEXT_PUBLIC_APP_BUILD.
//
// This must never fail a deploy: anything unexpected writes nothing, and the
// banner then treats every page as possibly changed, which is the safe side.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const DIST = path.join(process.cwd(), ".next");

export function buildKey(env = process.env) {
  return (env.VERCEL_GIT_COMMIT_SHA || env.VERCEL_DEPLOYMENT_ID || "local").slice(0, 40);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

/** The browser files a page loads, from the manifest beside its server entry. */
function clientFiles(manifestFile) {
  if (!existsSync(manifestFile)) return [];
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(manifestFile, "utf8"), sandbox, { timeout: 2000 });
  const files = new Set();
  for (const m of Object.values(sandbox.__RSC_MANIFEST ?? {})) {
    for (const list of Object.values(m.entryJSFiles ?? {})) for (const f of list) files.add(f);
    for (const list of Object.values(m.entryCSSFiles ?? {})) for (const f of list) files.add(typeof f === "string" ? f : f.path);
  }
  return [...files].sort();
}

export function pageMap(dist = DIST) {
  const appDir = path.join(dist, "server", "app");
  const root = JSON.parse(readFileSync(path.join(dist, "build-manifest.json"), "utf8")).rootMainFiles ?? [];
  const pages = {};
  for (const entry of walk(appDir).filter((f) => f.endsWith(`${path.sep}page.js`))) {
    const route = "/" + path.relative(appDir, entry).split(path.sep).join("/").replace(/\.js$/, "");
    const hash = createHash("sha256");
    for (const f of [...root].sort()) hash.update(`c:${f}\n`);
    for (const f of clientFiles(entry.replace(/page\.js$/, "page_client-reference-manifest.js"))) hash.update(`c:${f}\n`);
    const chunks = [...readFileSync(entry, "utf8").matchAll(/R\.c\("([^"]+)"\)/g)].map((m) => m[1]).sort();
    for (const c of chunks) {
      hash.update(`s:${c}\n`);
      hash.update(readFileSync(path.join(dist, c)));
    }
    pages[route] = hash.digest("hex").slice(0, 16);
  }
  return pages;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const pages = pageMap();
    if (Object.keys(pages).length === 0) throw new Error("no pages found");
    const out = path.join(DIST, "static", "cloudtime-build");
    mkdirSync(out, { recursive: true });
    const key = buildKey();
    writeFileSync(path.join(out, `${encodeURIComponent(key)}.json`), JSON.stringify({ build: key, pages }));
    console.log(`Page fingerprints: ${Object.keys(pages).length} pages for build ${key.slice(0, 12)}`);
  } catch (e) {
    console.warn(`Page fingerprints skipped (${e instanceof Error ? e.message : e}); the new version banner will treat every page as changed.`);
  }
}
