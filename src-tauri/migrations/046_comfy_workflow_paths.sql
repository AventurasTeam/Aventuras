-- A ComfyUI custom workflow's prompt and negative are lists, `positivePromptPaths` and
-- `negativePromptPaths`; the single-path keys they replace are folded in. An input the prompt takes
-- is not also a negative. Entries that are not objects cannot load as profiles, so they are dropped.
UPDATE settings
SET value = (
  SELECT json_group_array(
    json(
      CASE
        WHEN json_type(p.value, '$.providerOptions.customWorkflow') = 'object'
        THEN json_remove(
          json_set(
            p.value,
            '$.providerOptions.customWorkflow.positivePromptPaths',
            json(
              CASE
                WHEN coalesce(p.value ->> '$.providerOptions.customWorkflow.positivePromptPath', '') <> ''
                THEN json_array(p.value ->> '$.providerOptions.customWorkflow.positivePromptPath')
                ELSE '[]'
              END
            ),
            '$.providerOptions.customWorkflow.negativePromptPaths',
            json(
              CASE
                WHEN coalesce(p.value ->> '$.providerOptions.customWorkflow.negativePromptPath', '') <> ''
                  AND p.value ->> '$.providerOptions.customWorkflow.negativePromptPath'
                    IS NOT p.value ->> '$.providerOptions.customWorkflow.positivePromptPath'
                THEN json_array(p.value ->> '$.providerOptions.customWorkflow.negativePromptPath')
                ELSE '[]'
              END
            )
          ),
          '$.providerOptions.customWorkflow.positivePromptPath',
          '$.providerOptions.customWorkflow.negativePromptPath'
        )
        ELSE p.value
      END
    )
    ORDER BY p.key
  )
  FROM json_each(settings.value) AS p
  WHERE p.type = 'object'
)
WHERE key = 'image_profiles'
  AND json_valid(value)
  AND json_type(value) = 'array';

-- `KSamplerAdvanced` and `SamplerCustom` keep their seed in `noise_seed`, so a seed path that names
-- `seed` on a node with only `noise_seed` is pointed at it. The node is matched by key, never
-- spliced into a JSON path.
UPDATE settings
SET value = (
  SELECT json_group_array(
    json(
      CASE
        WHEN json_type(p.value, '$.providerOptions.customWorkflow') = 'object'
        THEN json_set(
          p.value,
          '$.providerOptions.customWorkflow.seedPath',
          CASE
            WHEN p.value ->> '$.providerOptions.customWorkflow.seedPath' GLOB '*.inputs.seed'
              AND instr(
                substr(
                  p.value ->> '$.providerOptions.customWorkflow.seedPath',
                  1,
                  length(p.value ->> '$.providerOptions.customWorkflow.seedPath') - 12
                ),
                '.'
              ) = 0
              AND EXISTS (
                SELECT 1
                FROM json_each(p.value, '$.providerOptions.customWorkflow.workflow') AS n
                WHERE n.key = substr(
                    p.value ->> '$.providerOptions.customWorkflow.seedPath',
                    1,
                    length(p.value ->> '$.providerOptions.customWorkflow.seedPath') - 12
                  )
                  AND json_type(n.value, '$.inputs.seed') IS NULL
                  AND json_type(n.value, '$.inputs.noise_seed') IS NOT NULL
              )
            THEN substr(
                p.value ->> '$.providerOptions.customWorkflow.seedPath',
                1,
                length(p.value ->> '$.providerOptions.customWorkflow.seedPath') - 12
              ) || '.inputs.noise_seed'
            ELSE p.value ->> '$.providerOptions.customWorkflow.seedPath'
          END
        )
        ELSE p.value
      END
    )
    ORDER BY p.key
  )
  FROM json_each(settings.value) AS p
  WHERE p.type = 'object'
)
WHERE key = 'image_profiles'
  AND json_valid(value)
  AND json_type(value) = 'array';
