# Deferred migrations

SQL that is written and reviewed but **must not run on the next deploy**.

`prisma migrate deploy` applies everything under `prisma/schema/migrations`
during the Vercel build — while the *previous* deployment is still serving
traffic. A migration that removes something the currently-running code still
uses will therefore break production for the length of the build, and a
migration that guards against that will fail the build instead.

Files here are staged out of that path on purpose. To apply one:

1. Confirm the code that no longer needs the thing is actually serving —
   probe the deployed API, do not assume a push deployed.
2. `mkdir prisma/schema/migrations/<name>/`
3. `mv prisma/deferred-migrations/<name>.sql prisma/schema/migrations/<name>/migration.sql`
4. Commit and deploy as usual.

Each file's header states what must be true before it is safe.
