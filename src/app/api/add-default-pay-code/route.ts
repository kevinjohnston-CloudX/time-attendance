import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  // Add column if not already present
  await db.$executeRaw`
    ALTER TABLE rule_sets
    ADD COLUMN IF NOT EXISTS "defaultPayCodeId" VARCHAR(30)
  `;

  // Add FK constraint (swallows error if it already exists)
  await db.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE rule_sets
        ADD CONSTRAINT fk_rule_sets_default_pay_code
        FOREIGN KEY ("defaultPayCodeId") REFERENCES pay_codes(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // Set defaultPayCodeId to pay code 0 (Regular Hours) for all rule sets that don't have one yet
  const updated = await db.$executeRaw`
    UPDATE rule_sets rs
    SET "defaultPayCodeId" = pc.id
    FROM pay_codes pc
    WHERE pc."tenantId" = rs."tenantId"
      AND pc.code = 0
      AND rs."defaultPayCodeId" IS NULL
  `;

  return NextResponse.json({ ok: true, ruleSetsUpdated: updated });
}
