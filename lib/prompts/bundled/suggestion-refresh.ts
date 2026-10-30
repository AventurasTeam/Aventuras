import type { TemplateSources } from '../types'

export const SUGGESTION_REFRESH: TemplateSources = {
  // rstrip: a JSON contract may be appended after this half with its own blank line, which the
  // last block's separator would double.
  system: `{%- capture definitionBlocks -%}
{% if definition.setting != blank -%}
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
{%- endcapture -%}
{{ definitionBlocks | rstrip }}`,
  // Structured-output call: the emission section asks for a JSON field, NOT the tagged
  // <suggestions> block (macro_suggestion_emission is the narrative fold's, appended to prose).
  user: `{%- comment -%}
The narrator's in-scene list (per-turn.ts), without ids: nothing here writes state. Assigned
first: LiquidJS drops a filter on a for tag's collection.
{%- endcomment -%}
{%- assign activeEntities = entities | active -%}
{%- assign inScene = '' | split: ',' -%}
{%- for e in activeEntities -%}
{%- if sceneEntities contains e.id -%}
{%- assign listedElsewhere = false -%}
{%- if e.state.holder and e.state.holder.status == 'active' and sceneEntities contains e.state.holder.id -%}{%- assign listedElsewhere = true -%}{%- endif -%}
{%- unless listedElsewhere -%}{%- assign inScene = inScene | push: e -%}{%- endunless -%}
{%- endif -%}
{%- endfor -%}
{% if inScene.size > 0 -%}
# In scene
{% for e in inScene %}
## {{ e.name }}{% if e.description != blank %}
{{ e.description }}{% endif %}{% include 'macro_entity_state', e: e, here: true, ids: false %}
{% endfor %}
{% endif -%}
# Story so far
{% for entry in entries %}
{% include 'macro_story_entry', entry: entry %}
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
{%- endif -%}`,
}
