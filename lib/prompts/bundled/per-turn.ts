// `entities` use the drizzle row shape (camelCase: id/kind/name/description/
// status/injectionMode). `sceneEntities` is the id array from entry metadata.
// The scene loop is intentionally injectionMode-agnostic — that IS the
// structural-floor invariant (active + in-scene always inject).
export const PER_TURN_NARRATIVE = `{% if definition.setting != blank -%}
# Setting
{{ definition.setting }}

{% endif -%}
{% if definition.genre.promptBody != blank -%}
# Genre
{{ definition.genre.promptBody }}

{% endif -%}
{% if definition.tone.promptBody != blank -%}
# Tone
{{ definition.tone.promptBody }}

{% endif -%}
{%- assign hasScene = false -%}
{%- for e in entities | active -%}
{%- if sceneEntities contains e.id -%}{%- assign hasScene = true -%}{%- endif -%}
{%- endfor -%}
{% if hasScene -%}
# Characters in scene
{% for e in entities | active -%}
{%- if sceneEntities contains e.id %}
## {{ e.name }}
{{ e.description }}
{% endif -%}
{%- endfor %}

{% endif -%}
# Story so far
{% for entry in entries %}
{{ entry.content }}
{% endfor %}
{% include 'macro_output_format_narrative' %}`
