-- The in-story time a story created from this scenario starts at, as a JSON TimeTracker.
--
-- NULL means the scenario has no view, so the wizard's start field is left to the reader or to
-- opening generation. Existing scenarios read as having none.
ALTER TABLE scenario_vault ADD COLUMN starting_time TEXT;
