-- Image profiles of provider "openai" that point at a proxy move to "openai-compatible".
--
-- The OpenAI image provider now lists only gpt-image models and reads b64_json replies; a proxy
-- belongs on the provider built for it. Key, base URL and model carry over. A profile with no base
-- URL, or one at api.openai.com, stays on "openai". An array holding anything but objects is left
-- alone.
UPDATE settings
SET value = (
  SELECT json_group_array(
    json(
      CASE
        WHEN p.value ->> '$.providerType' = 'openai'
          AND trim(coalesce(p.value ->> '$.baseUrl', '')) <> ''
          AND NOT (
            lower(trim(p.value ->> '$.baseUrl')) = 'https://api.openai.com'
            OR lower(trim(p.value ->> '$.baseUrl')) LIKE 'https://api.openai.com/%'
          )
        THEN json_set(p.value, '$.providerType', 'openai-compatible')
        ELSE p.value
      END
    )
    ORDER BY p.key
  )
  FROM json_each(settings.value) AS p
)
WHERE key = 'image_profiles'
  AND json_valid(value)
  AND json_type(value) = 'array'
  AND NOT EXISTS (SELECT 1 FROM json_each(settings.value) WHERE type <> 'object');
