export const MEMORY_BLOCKS = `{%- comment -%}
Every entity row has one shape, pinned, a scene's faction or ranked: [id] on \`ids\`, the head
with its framing, then macro_entity_state's lines. A ranked row renders from the data the ranker
measured, and lib/retrieval/rendered-text.ts builds the measured string as a mirror of this row.
Wrapping a ranked row costs RANKER_DEFAULTS.typeOverhead once per ROW, which is why the
<scene_entities> and <current_location> instructions live in the including template instead.
Only an entity row brackets an id: <state> references entities and nothing else, so an id
anywhere else below invites a reference no parser resolves. Assigned first: LiquidJS drops a
filter on a for tag's collection.
{%- endcomment -%}
{%- assign mb_entities = structuralPinnedEntities | concat: structuralSceneFactions | concat: retrievedEntities -%}
{% if mb_entities.size > 0 -%}
# Elsewhere in the world
{% for e in mb_entities %}
{% if ids %}[{{ e.id }}] {% endif %}{{ e.name }}{% if e.status == 'staged' %} (available to introduce){% elsif e.status == 'active' and e.kind != 'faction' %} (not in the scene){% endif %}{% if e.description != blank %}: {{ e.description }}{% endif %}{% include 'macro_entity_state', e: e, here: false, ids: ids %}
{% endfor %}
{% endif -%}
{% if structuralPinnedLore.size > 0 or retrievedLore.size > 0 -%}
# Relevant lore
{% for l in structuralPinnedLore %}
{{ l.title }}{% if l.body != blank %}
{{ l.body }}{% endif %}
{% endfor %}
{%- for l in retrievedLore %}
{{ l.renderedText }}
{% endfor %}
{% endif -%}
{% if retrievedHappenings.size > 0 -%}
# What has happened
{% for h in retrievedHappenings %}
{{ h.renderedText }}
{% endfor %}
{% endif -%}
{% if structuralActiveThreads.size > 0 -%}
# Active threads
{% for t in structuralActiveThreads %}
{{ t.title }}{% if t.description != blank %}
{{ t.description }}{% endif %}
{% endfor %}
{% endif -%}
{% if structuralPinnedThreads.size > 0 or retrievedThreads.size > 0 -%}
# Background threads
{% for t in structuralPinnedThreads %}
{{ t.title }} ({{ t.status }}){% if t.description != blank %}
{{ t.description }}{% endif %}
{% endfor %}
{%- for t in retrievedThreads %}
{{ t.renderedText }}
{% endfor %}
{% endif -%}
{% if retrievedChapters.size > 0 -%}
# Earlier chapters
{% for c in retrievedChapters %}
{{ c.renderedText }}
{% endfor %}
{% endif -%}`
