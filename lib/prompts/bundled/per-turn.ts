import type { TemplateSources } from '../types'

export const PER_TURN_NARRATIVE: TemplateSources = {
  // The system half must render the same bytes on every call until the user edits
  // the story (architecture.md → System and user halves): nothing per call goes in it.
  system: `{% if definition.setting != blank -%}
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
{% if calendarVocabulary -%}
# Calendar
This story tracks time in {{ calendarVocabulary.baseUnitName }}s{% if calendarVocabulary.secondsPerBaseUnit != 1 %} ({{ calendarVocabulary.secondsPerBaseUnit }} seconds per {{ calendarVocabulary.baseUnitName }}){% endif %}. Tiers: {% for t in calendarVocabulary.tiers %}{{ t.name }}{% if t.labels.size > 0 %} ({{ t.labels | prose_join }}){% endif %}{% unless forloop.last %}, {% endunless %}{% endfor %}.{% if piggybackFires %} Convert relative-time prose ("two days later", "the next morning") into a seconds delta on <world_time_delta> using these units.{% endif %}

{% endif -%}
{% include 'macro_output_format_narrative' %}`,
  // The scene loop ignores injectionMode on purpose (structural-floor invariant: active +
  // in-scene always inject), reading `entities`, not the floor, so it holds without retrieval.
  user: `{%- comment -%}
LiquidJS drops a filter on a for tag's collection, so the list is assigned first. The second
half of the scene test de-dupes the row the classifier named as both in-scene and the location;
it is nil-safe, since a null structuralLocation makes it "e.id != nil", which is true. An item
its in-scene holder's Holds lists, or one listed under Here:, is not listed again
(piggyback.md → What the writer sees). The Here: test checks for a location first: with no
current location, a null one's id would match, since nil == nil.
{%- endcomment -%}
{%- assign activeEntities = entities | active -%}
{%- assign inScene = '' | split: ',' -%}
{%- for e in activeEntities -%}
{%- if sceneEntities contains e.id and e.id != structuralLocation.id -%}
{%- assign listedElsewhere = false -%}
{%- if e.state.holder and e.state.holder.status == 'active' and sceneEntities contains e.state.holder.id -%}{%- assign listedElsewhere = true -%}{%- endif -%}
{%- if e.kind == 'item' and e.state.location and e.state.location.id == structuralLocation.id -%}{%- assign listedElsewhere = true -%}{%- endif -%}
{%- unless listedElsewhere -%}{%- assign inScene = inScene | push: e -%}{%- endunless -%}
{%- endif -%}
{%- endfor -%}
{% if inScene.size > 0 -%}
# In scene
{% for e in inScene %}
## {{ e.name }}{% if piggybackFires %} [{{ e.id }}]{% endif %}{% if e.description != blank %}
{{ e.description }}{% endif %}{% include 'macro_entity_state', e: e, here: true, ids: piggybackFires %}
{% endfor %}
{% endif -%}
{% if structuralLocation -%}
# Current location

{% if piggybackFires %}[{{ structuralLocation.id }}] {% endif %}{{ structuralLocation.name }}{% if currentLocationChain.size > 0 %} — in {{ currentLocationChain | join: ' › ' }}{% endif %}{% if structuralLocation.description != blank %}: {{ structuralLocation.description }}{% endif %}{% include 'macro_entity_state', e: structuralLocation, here: true, ids: piggybackFires %}{% if looseItems.size > 0 %}
Here:{% for i in looseItems %}{% include 'macro_item_line', item: i, condition: i.state.condition, ids: piggybackFires %}{% endfor %}{% endif %}

{% endif -%}
{% if locationMap.size > 0 or locationMapUnplaced.size > 0 -%}
# Places
{% for p in locationMap %}{% for d in (1..p.depth) %}  {% endfor %}{% if p.retired %}{{ p.name }} (retired{% if p.retiredReason %}: {{ p.retiredReason }}{% endif %}){% else %}{% if piggybackFires %}[{{ p.id }}] {% endif %}{{ p.name }}{% endif %}
{% endfor %}{% if locationMapUnplaced.size > 0 %}Unplaced:
{% for p in locationMapUnplaced %}  {% for d in (1..p.depth) %}  {% endfor %}{% if p.retired %}{{ p.name }} (retired{% if p.retiredReason %}: {{ p.retiredReason }}{% endif %}){% else %}{% if piggybackFires %}[{{ p.id }}] {% endif %}{{ p.name }}{% endif %}
{% endfor %}{% endif %}
{% endif -%}
{% include 'macro_memory_blocks', ids: piggybackFires -%}
{% if piggybackFires -%}
{% if structuralPinnedEntities.size > 0 or retrievedEntities.size > 0 -%}
If any off-scene character above enters the scene, include their ID (without brackets) in the trailing <scene_entities> block.

{% endif -%}
{% if placesListed -%}
Use an ID from Places for <current_location>, or declare a new one with <new_location> in the state block below when the scene settles somewhere new.

{% endif -%}
{% endif -%}
# Story so far
{% for entry in entries %}
{{ entry.content }}
{% endfor %}
{%- comment -%}
Each emission block opens with one newline: a blank line after the story's last
entry, none between the state and suggestions blocks when both fire.
{%- endcomment -%}
{%- if piggybackFires %}
{% include 'macro_state_emission' %}
{%- endif -%}
{%- if suggestionsFire %}
{% include 'macro_suggestion_emission' %}
{%- endif %}`,
}
