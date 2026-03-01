-- Add description and sort_order to pack variables, and custom_variable_values to stories

ALTER TABLE pack_variables ADD COLUMN description TEXT;

ALTER TABLE pack_variables ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Initialize sort_order based on alphabetical position within each pack
UPDATE pack_variables SET sort_order = (
  SELECT COUNT(*) FROM pack_variables pv2
  WHERE pv2.pack_id = pack_variables.pack_id
  AND pv2.variable_name < pack_variables.variable_name
);

-- Per-story custom variable value overrides (JSON object: { variableName: value })
ALTER TABLE stories ADD COLUMN custom_variable_values TEXT;
