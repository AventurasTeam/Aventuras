-- stories.settings.classifierMentionedPlaces is new here. The schema defaults it
-- to false, but settings writes are key-scoped json_set (settings-ops.ts), so the
-- default never materialises in an existing blob and only a raw-column reader
-- would see the gap. Guarded like 0013: absent or null keys only, valid object
-- blobs only, json_valid first.
UPDATE stories
SET settings = json_set(settings, '$.classifierMentionedPlaces', json('false'))
WHERE settings IS NOT NULL
	AND json_valid(settings)
	AND json_type(settings) = 'object'
	AND json_extract(settings, '$.classifierMentionedPlaces') IS NULL;
