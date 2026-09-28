-- A role can be limited to Live Attendance: sign in lands there, the menu
-- shows only that page, every other page sends the person back, and the
-- Live Attendance downloads are off.
-- Additive and off for every existing role. IF NOT EXISTS so it is a no-op if
-- the column was applied ahead of the deploy.
ALTER TABLE "custom_roles" ADD COLUMN IF NOT EXISTS "liveAttendanceOnly" BOOLEAN NOT NULL DEFAULT false;
