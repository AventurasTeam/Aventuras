-- stories.settings.retrievalBudgets carries TOKEN budgets; every value written
-- before this migration is a row COUNT, and a count-shaped number sits below
-- the memory-blocks macro's own per-row overhead, so each type seats zero rows
-- forever. Unconditional because nothing but story creation has ever written
-- this key, so no stored value can be a user-chosen token budget.
UPDATE stories
SET settings = json_set(
	settings,
	'$.retrievalBudgets',
	json('{"entities":1200,"lore":1800,"happenings":1500,"threads":400,"chapters":600}')
)
-- json_set raises on non-JSON text, and one such row would abort the whole
-- statement: no story migrates and the app cannot boot past migrate(). A corrupt
-- settings blob is already a per-story recoverable state elsewhere
-- (lib/actions/stories/operational.ts sets a settings-corrupt open failure), so
-- skip those rows and leave the rest of the database migratable.
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object';
