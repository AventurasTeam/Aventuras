-- Reasoning effort: 'off' was renamed 'none' in 0.7.x, and the legacy enable_thinking boolean is
-- folded into the stored level.

UPDATE settings SET value = 'none'
WHERE key = 'main_reasoning_effort' AND value = 'off';

-- The blobs are written by JSON.stringify, so the pair appears exactly in this form.
UPDATE settings
SET value = replace(value, '"reasoningEffort":"off"', '"reasoningEffort":"none"')
WHERE key IN ('wizard_settings', 'generation_presets', 'system_services_settings');

-- Installs older than main_reasoning_effort kept only enable_thinking, which meant 'high'. It
-- applies wherever no readable level is stored.
INSERT INTO settings (key, value)
SELECT 'main_reasoning_effort', 'high'
FROM settings
WHERE key = 'enable_thinking' AND value = 'true'
ON CONFLICT (key) DO UPDATE SET value = excluded.value
WHERE value NOT IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max');

DELETE FROM settings WHERE key = 'enable_thinking';
