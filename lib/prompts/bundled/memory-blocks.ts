export const MEMORY_BLOCKS = `{%- comment -%}
Two row families, never one loop: ranked rows carry the exact renderedText the
ranker measured the type budget against; structural-floor rows are raw column
projections that bypass the ranker entirely. Wrapping a ranked row costs
RANKER_DEFAULTS.typeOverhead once per ROW, which is why the <scene_entities>
and <current_location> instructions live in the including template instead.
Only the entity block brackets an id: <state> references entities and nothing
else, so an id anywhere below invites a reference no parser resolves.
{%- endcomment -%}
{% if structuralPinnedEntities.size > 0 or retrievedEntities.size > 0 -%}
# Elsewhere in the world
{% for e in structuralPinnedEntities %}
{% if piggybackFires %}[{{ e.id }}] {% endif %}{{ e.name }}{% if e.status == 'active' %} (currently elsewhere){% elsif e.status == 'staged' %} (available to introduce){% endif %}{% if e.description != blank %}: {{ e.description }}{% endif %}
{% endfor %}
{%- for e in retrievedEntities %}
{% if piggybackFires %}[{{ e.id }}] {% endif %}{{ e.renderedText }}
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
