-- The checkpoint explanation's fold state moves under the prefix every explanation fold shares.

INSERT INTO settings (key, value)
SELECT 'explanation_folded:checkpoint_help', value
FROM settings
WHERE key = 'checkpoint_help_folded'
ON CONFLICT (key) DO NOTHING;

DELETE FROM settings WHERE key = 'checkpoint_help_folded';
