-- entities.is_lead is new in the step before this one. Each branch's lead moves off the story's
-- stored definition onto that branch's character row, whatever its status, and every turn already
-- on the branch is stamped with it. A stored id naming no character on a branch flags nothing
-- there, and that branch's entries stay unstamped. Each guard keeps json_valid first: json_type and
-- json_extract raise on a blob nested past SQLite's parser depth, where json_valid returns 0, and
-- one raise aborts migrate() at boot. One statement a chunk: Android prepares a chunk as one.
UPDATE entities
SET is_lead = 1
WHERE kind = 'character'
	AND id = (
		SELECT json_extract(stories.definition, '$.leadEntityId')
		FROM branches
		JOIN stories ON stories.id = branches.story_id
		WHERE branches.id = entities.branch_id
			AND stories.definition IS NOT NULL
			AND json_valid(stories.definition)
			AND json_type(stories.definition) = 'object'
	);
--> statement-breakpoint
-- Every user_action, ai_reply and opening on a flagged branch takes that branch's lead. NULL or
-- unreadable metadata stays as it is: json_set can't stamp NULL, and code writes NULL metadata
-- only on system entries.
UPDATE story_entries
SET metadata = json_set(
	metadata,
	'$.leadId',
	(SELECT entities.id FROM entities WHERE entities.branch_id = story_entries.branch_id AND entities.is_lead = 1)
)
WHERE kind IN ('user_action', 'ai_reply', 'opening')
	AND metadata IS NOT NULL
	AND json_valid(metadata)
	AND json_type(metadata) = 'object'
	AND EXISTS (
		SELECT 1 FROM entities WHERE entities.branch_id = story_entries.branch_id AND entities.is_lead = 1
	);
--> statement-breakpoint
-- The definition no longer carries the lead, drafts included. The key test is json_type on the
-- path, not json_extract, so a stored null goes too.
UPDATE stories
SET definition = json_remove(definition, '$.leadEntityId')
WHERE definition IS NOT NULL
	AND json_valid(definition)
	AND json_type(definition) = 'object'
	AND json_type(definition, '$.leadEntityId') IS NOT NULL;
