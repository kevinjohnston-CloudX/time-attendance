#!/usr/bin/env node
/**
 * Fails the build when company scoping can quietly come undone (security
 * audit 2026-11; CXT's scripts/check-ticket-access.mjs is the model).
 *
 * 1. A fail-open company filter: `tenantId ?? undefined` or
 *    `tenantId ? { tenantId } : {}` reads every company when the company is
 *    missing. Use ownCompany() (src/lib/rbac/company.ts).
 * 2. A table created by a migration without row protection. CloudTime
 *    connects as the owner, so the app is unaffected, but Supabase's public
 *    roles must find every table closed (September's C2).
 * 3. A server action that takes a person's id (input employeeId) and calls
 *    none of the scope helpers, so nothing holds it to the caller's company,
 *    sites and team.
 *
 * A line or action that is right as it is carries `company-scope-ok: <why>`.
 * Rule 3 keeps a baseline of actions that predate it (BASELINE below): each
 * one was read by hand; the list may only shrink.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(root, p);
const sources = walk(path.join(root, "src")).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p));

// 1. Fail-open company filters.
const FAIL_OPEN = [/\btenantId\s*\?\?\s*undefined/, /\btenantId\s*\?\s*\{\s*tenantId\s*\}\s*:\s*\{\s*\}/];
for (const file of sources) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (line.includes("company-scope-ok:") || /^\s*(\*|\/\/)/.test(line)) return;
    if (FAIL_OPEN.some((re) => re.test(line))) {
      problems.push(`${rel(file)}:${i + 1}  a missing company reads every company. Use ownCompany(tenantId).`);
    }
  });
}

// 2. Every table a migration creates has row protection. Tables before
// 20260928200000_lock_public_tables were closed by that migration as a set.
const migrations = path.join(root, "prisma/schema/migrations");
const dirs = readdirSync(migrations).filter((d) => statSync(path.join(migrations, d)).isDirectory()).sort();
const allSql = dirs.map((d) => readFileSync(path.join(migrations, d, "migration.sql"), "utf8")).join("\n");
for (const d of dirs) {
  if (d <= "20260928200000") continue;
  const sql = readFileSync(path.join(migrations, d, "migration.sql"), "utf8");
  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?([a-z_]+)"?/gi)) {
    const t = m[1];
    const closed = new RegExp(`ALTER TABLE (?:ONLY )?(?:public\\.)?"?${t}"? ENABLE ROW LEVEL SECURITY`, "i").test(allSql);
    if (!closed) problems.push(`prisma/schema/migrations/${d}  table "${t}" has no ENABLE ROW LEVEL SECURITY.`);
  }
}

// 3. Actions taking a person's id without a scope helper.
const SCOPE = /\b(assertRecordInReach|inReach|assertSite|assertNotSenior|employeeScope|assertBalanceChangeAllowed|assertEmployeeInScope|[a-zA-Z]+InScope|reachable|assertOwn|manageableLogin|scopedEmployee)\s*\(/;
const TAKES_PERSON = /\binput\.employeeId\b|\{[^}]*\bemployeeId\b(?!\s*:)[^}]*\}\s*=\s*(?:input|parsed|data|[A-Za-z]+Schema\.parse\()/;
const BASELINE = new Set([
  // Read by hand 2026-11-03, each held to the company another way.
]);
for (const file of sources.filter((p) => rel(p).startsWith("src/actions/"))) {
  const text = readFileSync(file, "utf8");
  const starts = [...text.matchAll(/export const (\w+) = withRBAC\(/g)];
  starts.forEach((m, i) => {
    const body = text.slice(m.index, starts[i + 1]?.index ?? text.length);
    if (!TAKES_PERSON.test(body) || SCOPE.test(body) || body.includes("company-scope-ok:")) return;
    const id = `${rel(file)}#${m[1]}`;
    if (!BASELINE.has(id)) problems.push(`${id}  takes a person's id but calls no scope helper.`);
  });
}

if (problems.length) {
  console.error(`check-company-scope: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("check-company-scope: ok");
