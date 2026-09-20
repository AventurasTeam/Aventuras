-- stories.settings.models[target] becomes { providerId, modelId }. Every bare-id
-- override written before this ran on app_settings.default_provider_id, so that
-- provider is the honest one to record; with no default the override was already
-- unresolvable and is dropped. A blank id names nothing and is dropped the same
-- way: adopting it would mint a modelId the schema refuses, so the story's whole
-- blob would stop parsing. json_valid guards keep one corrupt blob from aborting
-- the whole statement (see 0013 for the rationale).
UPDATE stories
SET settings = json_set(settings, '$.models.narrative', json_object(
	'providerId', (SELECT default_provider_id FROM app_settings WHERE id = 'singleton'),
	'modelId', json_extract(settings, '$.models.narrative')))
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models.narrative') = 'text'
	AND trim(json_extract(settings, '$.models.narrative')) <> ''
	AND (SELECT default_provider_id FROM app_settings WHERE id = 'singleton') IS NOT NULL;
--> statement-breakpoint
UPDATE stories
SET settings = json_remove(settings, '$.models.narrative')
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models.narrative') = 'text';
--> statement-breakpoint
UPDATE stories
SET settings = json_set(settings, '$.models.classifier', json_object(
	'providerId', (SELECT default_provider_id FROM app_settings WHERE id = 'singleton'),
	'modelId', json_extract(settings, '$.models.classifier')))
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models.classifier') = 'text'
	AND trim(json_extract(settings, '$.models.classifier')) <> ''
	AND (SELECT default_provider_id FROM app_settings WHERE id = 'singleton') IS NOT NULL;
--> statement-breakpoint
UPDATE stories
SET settings = json_remove(settings, '$.models.classifier')
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models.classifier') = 'text';
--> statement-breakpoint
UPDATE stories
SET settings = json_set(settings, '$.models.translation', json_object(
	'providerId', (SELECT default_provider_id FROM app_settings WHERE id = 'singleton'),
	'modelId', json_extract(settings, '$.models.translation')))
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models.translation') = 'text'
	AND trim(json_extract(settings, '$.models.translation')) <> ''
	AND (SELECT default_provider_id FROM app_settings WHERE id = 'singleton') IS NOT NULL;
--> statement-breakpoint
UPDATE stories
SET settings = json_remove(settings, '$.models.translation')
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models.translation') = 'text';
--> statement-breakpoint
UPDATE stories
SET settings = json_set(settings, '$.models.suggestion', json_object(
	'providerId', (SELECT default_provider_id FROM app_settings WHERE id = 'singleton'),
	'modelId', json_extract(settings, '$.models.suggestion')))
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models.suggestion') = 'text'
	AND trim(json_extract(settings, '$.models.suggestion')) <> ''
	AND (SELECT default_provider_id FROM app_settings WHERE id = 'singleton') IS NOT NULL;
--> statement-breakpoint
UPDATE stories
SET settings = json_remove(settings, '$.models.suggestion')
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models.suggestion') = 'text';
--> statement-breakpoint
UPDATE stories
SET settings = json_set(settings, '$.models."lore-mgmt"', json_object(
	'providerId', (SELECT default_provider_id FROM app_settings WHERE id = 'singleton'),
	'modelId', json_extract(settings, '$.models."lore-mgmt"')))
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models."lore-mgmt"') = 'text'
	AND trim(json_extract(settings, '$.models."lore-mgmt"')) <> ''
	AND (SELECT default_provider_id FROM app_settings WHERE id = 'singleton') IS NOT NULL;
--> statement-breakpoint
UPDATE stories
SET settings = json_remove(settings, '$.models."lore-mgmt"')
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models."lore-mgmt"') = 'text';
--> statement-breakpoint
UPDATE stories
SET settings = json_set(settings, '$.models.retrieval', json_object(
	'providerId', (SELECT default_provider_id FROM app_settings WHERE id = 'singleton'),
	'modelId', json_extract(settings, '$.models.retrieval')))
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models.retrieval') = 'text'
	AND trim(json_extract(settings, '$.models.retrieval')) <> ''
	AND (SELECT default_provider_id FROM app_settings WHERE id = 'singleton') IS NOT NULL;
--> statement-breakpoint
UPDATE stories
SET settings = json_remove(settings, '$.models.retrieval')
WHERE settings IS NOT NULL AND json_valid(settings) AND json_type(settings) = 'object'
	AND json_type(settings, '$.models.retrieval') = 'text';
