// Structured-output call: the emission section asks for a JSON field, NOT the
// tagged <suggestions> block macro_suggestion_emission instructs (that macro
// belongs to the narrative fold, which appends the block to prose).
export const SUGGESTION_REFRESH = `{% if definition.setting != blank -%}
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
# In scene
{% for e in entities | active -%}
{%- if sceneEntities contains e.id %}
## {{ e.name }}
{{ e.description }}
{% endif -%}
{%- endfor %}

{% endif -%}
# Story so far
{%- assign recentEntries = entries | recent: userSettings.partialChapterBuffer %}
{% for entry in recentEntries %}
{{ entry.content }}
{% endfor %}
{%- if suggestionsFire %}
# Next-turn options
{% include 'macro_suggestion_emission_json' %}
{%- endif -%}
{%- if refreshGuidance != blank %}

The reader has already started writing their next turn:

{{ refreshGuidance }}

Build on that direction — take it further or offer variations of it — without repeating it back verbatim.
{%- endif -%}`
