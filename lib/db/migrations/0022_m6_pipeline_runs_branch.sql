-- pipeline_runs.branch_id is new in the step before this one, and recovery scopes an unfinished
-- run's group by it. Unfinished rows only: action_id has no index to backfill every row by, and
-- recovery and the copy refusals read only unfinished runs. No copy exists yet, so each source
-- names the run's own branch. Reads no JSON, so there is no blob for a guard to skip.
UPDATE pipeline_runs SET branch_id = COALESCE(
	(SELECT branch_id FROM deltas WHERE deltas.action_id = pipeline_runs.action_id LIMIT 1),
	(SELECT branch_id FROM reversal_journals WHERE reversal_journals.action_id = pipeline_runs.action_id LIMIT 1),
	-- Only a re-run's marker names a chapter: one left with no delta and no journal.
	(SELECT branch_id FROM chapters WHERE chapters.id = pipeline_runs.rerun_chapter_id LIMIT 1))
WHERE finished_at IS NULL;
