-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actorId_fkey";

-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "actorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
