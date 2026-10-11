// `entities` use the drizzle row shape (camelCase: id/kind/name/description/
// status/injectionMode). `sceneEntities` is the id array from entry metadata.
// The scene loop is intentionally injectionMode-agnostic — that IS the
// structural-floor invariant (active + in-scene always inject). It derives the
// set from `entities` rather than from the floor so the invariant survives a
// context built with no retrieval outcome, where every floor bundle is empty.
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
makes the comparison "e.id != nil", which is true. An item a holder's Holds
line names is not listed again (piggyback.md → What the writer sees).
{%- endcomment -%}
{%- assign heldIds = '' | split: ',' -%}
{%- for h in heldItems -%}{%- assign ids = h.items | map: 'id' -%}{%- assign heldIds = heldIds | concat: ids -%}{%- endfor -%}
{%- assign hasScene = false -%}
{%- for e in entities | active -%}
{%- if sceneEntities contains e.id and e.id != structuralLocation.id -%}{%- assign hasScene = true -%}{%- endif -%}
{%- endfor -%}
{% if hasScene -%}
# In scene
{% for e in entities | active -%}
{%- if sceneEntities contains e.id and e.id != structuralLocation.id -%}
{%- unless heldIds contains e.id %}
## {{ e.name }}{% if piggybackFires %} [{{ e.id }}]{% endif %}{% if e.description != blank %}
{{ e.description }}{% endif %}{% for h in heldItems %}{% if h.holderId == e.id %}
Holds: {% for i in h.items %}{% if piggybackFires %}[{{ i.id }}] {% endif %}{{ i.name }}{% if i.equipped %} (equipped){% endif %}{% unless forloop.last %}, {% endunless %}{% endfor %}{% endif %}{% endfor %}
{% endunless -%}
{%- endif -%}
{%- endfor %}

{% endif -%}
{% if structuralLocation -%}
# Current location

{% if piggybackFires %}[{{ structuralLocation.id }}] {% endif %}{{ structuralLocation.name }}{% if currentLocationChain.size > 0 %} — in {{ currentLocationChain | join: ' › ' }}{% endif %}{% if structuralLocation.description != blank %}: {{ structuralLocation.description }}{% endif %}{% if looseItems.size > 0 %}
Here: {% for i in looseItems %}{% if piggybackFires %}[{{ i.id }}] {% endif %}{{ i.name }}{% unless forloop.last %}, {% endunless %}{% endfor %}{% endif %}

{% endif -%}
{% if locationMap.size > 0 -%}
# Places
{% for p in locationMap %}{% for d in (1..p.depth) %}  {% endfor %}{% if piggybackFires %}[{{ p.id }}] {% endif %}{{ p.name }}
{% endfor %}
{% endif -%}
{% include 'macro_memory_blocks' -%}
{% if piggybackFires -%}
{% if structuralPinnedEntities.size > 0 or retrievedEntities.size > 0 -%}
If any off-scene character above enters the scene, include their ID (without brackets) in the trailing <scene_entities> block.

{% endif -%}
{% if locationMap.size > 0 -%}
Use an ID from Places for <current_location>, or declare a new one with <new_location> in the state block below when the scene settles somewhere new.

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
