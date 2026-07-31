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
{%- comment -%}
No suggestionsFire guard, unlike per-turn and the fallback classifier: those
emit chips only under a run-level condition (the tagged block firing / no chips
captured yet), while producing chips is the entire reason this call exists. Do
not add one for template-family symmetry: this phase deliberately does not set
suggestionsFire (the slots are the story's palette, not an instruction to
emit), so a guard here would always be FALSE and would silently omit the one
section this call exists to send. The palette-empty case never reaches here —
the phase returns first.
{%- endcomment %}
# Next-turn options
{% include 'macro_suggestion_emission_json' %}
{%- if refreshGuidance != blank %}

The reader has already started writing their next turn:

{{ refreshGuidance }}

Build on that direction — take it further or offer variations of it — without repeating it back verbatim.
{%- endif -%}`
