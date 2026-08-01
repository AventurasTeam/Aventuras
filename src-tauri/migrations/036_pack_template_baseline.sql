-- Remember which baseline each pack template was written from.
--
-- `refreshDefaultPackTemplates` keeps the default pack in step with the code by comparing
-- the stored `content_hash` against the hash of the current baseline and overwriting when
-- they differ. But `content_hash` is the hash of whatever is stored, and the template editor
-- writes through the same path -- so a user's own edit to a default-pack template made the
-- two differ and was silently reverted on the next app start. Every time.
--
-- `baseline_hash` records the hash of the baseline the row was last seeded or refreshed
-- from, and only pack-service writes it. A row is untouched when its content still hashes to
-- that value, and only untouched rows may be overwritten.
--
-- Existing rows are backfilled from `content_hash`, which reads whatever is there now as the
-- baseline. That errs toward keeping the user's content: an edit made before this migration
-- stops being reverted, at the cost of that one row no longer tracking future baseline
-- changes -- which is exactly what an edited row should do anyway.
ALTER TABLE pack_templates ADD COLUMN baseline_hash TEXT;

UPDATE pack_templates SET baseline_hash = content_hash WHERE baseline_hash IS NULL;
