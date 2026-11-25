-- Image profiles: settings written before image profiles existed become image profiles, then every
-- image profile is moved onto the providers that exist now.

-- Z.AI's default host is now api.z.ai. A zhipu profile with no base URL was talking to BigModel, so
-- it keeps that host. This runs first so the image profiles built from API profiles inherit it. An
-- array holding anything but objects is left alone.
UPDATE settings
SET value = (
  SELECT json_group_array(
    json(
      CASE
        WHEN p.value ->> '$.providerType' = 'zhipu'
          AND trim(coalesce(p.value ->> '$.baseUrl', '')) = ''
        THEN json_set(p.value, '$.baseUrl', 'https://open.bigmodel.cn/api/paas/v4')
        ELSE p.value
      END
    )
    ORDER BY p.key
  )
  FROM json_each(settings.value) AS p
)
WHERE key = 'api_profiles'
  AND json_valid(value)
  AND json_type(value) = 'array'
  AND NOT EXISTS (SELECT 1 FROM json_each(settings.value) WHERE type <> 'object');

-- A legacy slot is an image setting that names an API profile and a model. They count only while
-- no image profile has been saved.
CREATE TEMP TABLE legacy_image_slot AS
WITH slot(ord, field, model_field) AS (
  VALUES
    (1, 'profileId', 'model'),
    (2, 'referenceProfileId', 'referenceModel'),
    (3, 'portraitProfileId', 'portraitModel'),
    (4, 'backgroundProfileId', 'backgroundModel')
)
SELECT ord, field, api_id, model
FROM (
  SELECT
    slot.ord AS ord,
    slot.field AS field,
    coalesce(ss.value ->> ('$.imageGeneration.' || slot.field), '') AS api_id,
    coalesce(ss.value ->> ('$.imageGeneration.' || slot.model_field), '') AS model
  FROM settings AS ss, slot
  WHERE ss.key = 'system_services_settings'
    AND json_valid(ss.value)
    AND NOT EXISTS (
      SELECT 1
      FROM settings AS ip
      WHERE ip.key = 'image_profiles'
        AND json_valid(ip.value)
        AND json_type(ip.value) = 'array'
        AND json_array_length(ip.value) > 0
    )
)
WHERE api_id <> '' AND model <> '';

-- One image profile per distinct API profile and model, for the providers that draw images.
CREATE TEMP TABLE legacy_image_profile AS
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
    || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1)
    || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))) AS id,
  ord, api_id, model, name, provider_type, api_key, base_url
FROM (
  SELECT
    s.api_id AS api_id,
    s.model AS model,
    min(s.ord) AS ord,
    a.value ->> '$.name' AS name,
    a.value ->> '$.providerType' AS provider_type,
    coalesce(a.value ->> '$.apiKey', '') AS api_key,
    a.value ->> '$.baseUrl' AS base_url
  FROM legacy_image_slot AS s,
    (
      SELECT value FROM settings
      WHERE key = 'api_profiles' AND json_valid(value) AND json_type(value) = 'array'
    ) AS ap,
    json_each(ap.value) AS a
  WHERE a.type = 'object'
    AND a.value ->> '$.id' = s.api_id
    AND a.value ->> '$.providerType' IN ('nanogpt', 'openai', 'chutes', 'pollinations', 'google', 'zhipu')
  GROUP BY s.api_id, s.model
);

INSERT INTO settings (key, value)
SELECT 'image_profiles', profiles
FROM (
  SELECT
    count(*) AS n,
    json_group_array(
      json_patch(
        json_object(
          'id', id,
          'name', name || ' (' || model || ')',
          'providerType', provider_type,
          'apiKey', api_key,
          'model', model,
          'providerOptions', json_object(),
          'createdAt', CAST(unixepoch('subsec') * 1000 AS INTEGER)
        ),
        json_object('baseUrl', base_url)
      )
      ORDER BY ord
    ) AS profiles
  FROM legacy_image_profile
)
WHERE n > 0
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- Slots point at the new profiles; the per-slot model fields they replace are dropped.
UPDATE settings
SET value = json_patch(
  json_patch(
    value,
    json_object(
      'imageGeneration',
      json((
        SELECT json_group_object(s.field, p.id)
        FROM legacy_image_slot AS s
        JOIN legacy_image_profile AS p ON p.api_id = s.api_id AND p.model = s.model
      ))
    )
  ),
  '{"imageGeneration":{"model":null,"referenceModel":null,"portraitModel":null,"backgroundModel":null}}'
)
WHERE key = 'system_services_settings'
  AND json_valid(value)
  AND json_type(value, '$.imageGeneration') = 'object';

DROP TABLE legacy_image_slot;
DROP TABLE legacy_image_profile;

-- Profiles of provider "openai" that point at a proxy move to "openai-compatible": the OpenAI
-- provider lists only gpt-image models and reads b64_json replies. A profile with no base URL, or
-- one at api.openai.com, stays on "openai". "chutes" has no image provider and moves there too; an
-- empty base URL becomes https://api.chutes.ai/v1. A "zhipu" profile with an empty base URL is
-- pinned to https://open.bigmodel.cn/api/paas/v4, as its API profile is. An array holding anything
-- but objects is left alone.
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
        WHEN p.value ->> '$.providerType' = 'chutes'
        THEN json_set(
          p.value,
          '$.providerType', 'openai-compatible',
          '$.baseUrl', coalesce(nullif(trim(p.value ->> '$.baseUrl'), ''), 'https://api.chutes.ai/v1')
        )
        WHEN p.value ->> '$.providerType' = 'zhipu'
          AND trim(coalesce(p.value ->> '$.baseUrl', '')) = ''
        THEN json_set(p.value, '$.baseUrl', 'https://open.bigmodel.cn/api/paas/v4')
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

-- A profile without a model gets "flux", or "cogview-4-250304" for zhipu, which is what it was
-- running.
UPDATE settings
SET value = (
  SELECT json_group_array(
    json(
      CASE
        WHEN coalesce(p.value ->> '$.model', '') = ''
        THEN json_set(
          p.value,
          '$.model',
          CASE WHEN p.value ->> '$.providerType' = 'zhipu' THEN 'cogview-4-250304' ELSE 'flux' END
        )
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
