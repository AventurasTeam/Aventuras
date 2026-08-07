// `entities` use the drizzle row shape (camelCase: id/kind/name/description/
// status/injectionMode). `sceneEntities` is the id array from entry metadata.
// The scene loop is intentionally injectionMode-agnostic — that IS the
// structural-floor invariant (active + in-scene always inject). It reads
// `entities` rather than `structuralSceneEntities` so the invariant survives a
// context built with no retrieval outcome — no retrieval phase ran ahead of the
// render — where every floor bundle arrives empty.
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
{%- comment -%}
The second half of the condition de-dupes the row the classifier named as both
in-scene and the location; it is nil-safe, since a null structuralLocation
makes the comparison "e.id != nil", which is true.
{%- endcomment -%}
{%- assign hasScene = false -%}
{%- for e in entities | active -%}
{%- if sceneEntities contains e.id and e.id != structuralLocation.id -%}{%- assign hasScene = true -%}{%- endif -%}
{%- endfor -%}
{% if hasScene -%}
# In scene
{% for e in entities | active -%}
{%- if sceneEntities contains e.id and e.id != structuralLocation.id %}
## {{ e.name }}{% if piggybackFires %} [{{ e.id }}]{% endif %}{% if e.description != blank %}
{{ e.description }}{% endif %}
{% endif -%}
{%- endfor %}

{% endif -%}
{% if structuralLocation -%}
# Current location

{% if piggybackFires %}[{{ structuralLocation.id }}] {% endif %}{{ structuralLocation.name }}{% if structuralLocation.description != blank %}: {{ structuralLocation.description }}{% endif %}

{% endif -%}
{% include 'macro_memory_blocks' -%}
{% if piggybackFires -%}
{% if structuralPinnedEntities.size > 0 or retrievedEntities.size > 0 -%}
If any off-scene character above enters the scene, include their ID (without brackets) in the trailing <scene_entities> block.

{% endif -%}
{%- comment -%}
The ids are enumerated rather than referred to as "the IDs above": the memory
blocks are kind-blind (RetrievedRow has no EntityKind), so pointing
<current_location> at them would offer a set that can be all characters, and
nothing downstream kind-checks what comes back. locationIds is the kind-filtered
union the builder assembles for exactly this line.
{%- endcomment -%}
{% if locationIds.size > 0 -%}
Use one of these place IDs (without brackets) for <current_location> when the scene is at that place: {{ locationIds | join: ', ' }}. Leave it out if the scene moves somewhere not listed above.

{% endif -%}
{% endif -%}
{% if calendarVocabulary -%}
# Calendar
This story tracks time in {{ calendarVocabulary.baseUnitName }}s ({{ calendarVocabulary.secondsPerBaseUnit }} seconds per {{ calendarVocabulary.baseUnitName }}). Tiers: {% for t in calendarVocabulary.tiers %}{{ t.name }}{% if t.labels.size > 0 %} ({{ t.labels | prose_join }}){% endif %}{% unless forloop.last %}, {% endunless %}{% endfor %}.{% if piggybackFires %} Convert relative-time prose ("two days later", "the next morning") into a seconds delta on <world_time_delta> using these units.{% endif %}

{% endif -%}
# Story so far
{% for entry in entries %}
{{ entry.content }}
{% endfor %}
{% include 'macro_output_format_narrative' %}
{% if piggybackFires -%}
{% include 'macro_state_emission' %}
{%- endif -%}
{%- comment -%}
Documents the block below: one newline, no blank line, between the state and
suggestions blocks when both fire.
{%- endcomment -%}
{%- if piggybackFires and suggestionsFire %}
{% endif -%}
{%- if suggestionsFire -%}
{% include 'macro_suggestion_emission' %}
{%- endif %}`
