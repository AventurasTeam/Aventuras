-- stories.settings.classifierContextEntries is new here. Settings writes are
-- key-scoped json_set (settings-ops.ts), so a Zod-side default would never
-- materialise in an existing blob: reads would apply it while the stored column
-- stayed short. Guarded on the key being absent rather than written
-- unconditionally like 0007, so the statement is idempotent once users can
-- choose a depth of their own.
UPDATE stories
SET settings = json_set(settings, '$.classifierContextEntries', 4)
-- json_set raises on non-JSON text, and one such row would abort the whole
-- statement: no story migrates and the app cannot boot past migrate(). A corrupt
-- settings blob is already a per-story recoverable state elsewhere
-- (lib/actions/stories/operational.ts sets a settings-corrupt open failure), so
-- skip those rows and leave the rest of the database migratable.
WHERE settings IS NOT NULL
	AND json_valid(settings)
	AND json_type(settings) = 'object'
	AND json_extract(settings, '$.classifierContextEntries') IS NULL;
