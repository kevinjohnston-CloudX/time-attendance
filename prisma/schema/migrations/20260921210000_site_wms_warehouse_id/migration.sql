-- Oracle's warehouse id for a building, from the legacy WarehouseLocation enum
-- (Core/Wms.TimeClock.Core/Employee/TimeClockDetails.cs).
--
-- This is the link that lets an Oracle employee be placed in a building. The
-- roster sync already learns who exists, their department and their badge, but
-- not where they work -- and site is one of the four things an Employee cannot
-- be created without. Every staged RosterCandidate has had a null siteName for
-- exactly this reason.

-- AlterTable
ALTER TABLE "sites" ADD COLUMN "wmsWarehouseId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "sites_wmsWarehouseId_key" ON "sites"("wmsWarehouseId");

-- Only the buildings whose mapping is confirmed by live tablet traffic: every
-- reader at each of these has resolved to this site and no other. The two
-- Canadian sites are left null on purpose -- CAN (8) and CAN36 (18) are both
-- plausible for Brampton and Scarborough, and putting people in the wrong
-- building is worse than leaving the review queue as useful as it is today.
UPDATE "sites" SET "wmsWarehouseId" = 13 WHERE "name" = '0299 Rutherford';
UPDATE "sites" SET "wmsWarehouseId" = 5  WHERE "name" = '5903 Nj';
UPDATE "sites" SET "wmsWarehouseId" = 19 WHERE "name" = '7575 Georgia';
UPDATE "sites" SET "wmsWarehouseId" = 10 WHERE "name" = '6002 California';
UPDATE "sites" SET "wmsWarehouseId" = 15 WHERE "name" = '1055 Pa';
UPDATE "sites" SET "wmsWarehouseId" = 9  WHERE "name" = 'Netherlands Nl';
