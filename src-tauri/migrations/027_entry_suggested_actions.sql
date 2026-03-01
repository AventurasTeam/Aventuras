-- Store generated action suggestions per entry for time-travel consistency.
-- When entries are deleted (time travel), the saved actions from the new last entry
-- are restored instead of keeping stale ones from the deleted position.
-- JSON blob: either ActionChoice[] or Suggestion[] depending on story mode.
ALTER TABLE story_entries ADD COLUMN suggested_actions TEXT;
