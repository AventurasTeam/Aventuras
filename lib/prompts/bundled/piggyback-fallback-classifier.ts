import type { TemplateSources } from '../types'

// piggyback.md → Fallback classifier context: most of what the narrative call gets, minus
// Setting / Genre / Tone and either output-format macro, plus the flat bracketed ID roster.
export const PIGGYBACK_FALLBACK_CLASSIFIER: TemplateSources = {
  system: `{% if calendarVocabulary -%}
# Calendar
This story tracks time in {{ calendarVocabulary.baseUnitName }}s ({{ calendarVocabulary.secondsPerBaseUnit }} seconds per {{ calendarVocabulary.baseUnitName }}). Tiers: {% for t in calendarVocabulary.tiers %}{{ t.name }}{% if t.labels.size > 0 %} ({{ t.labels | prose_join }}){% endif %}{% unless forloop.last %}, {% endunless %}{% endfor %}. Convert relative-time prose ("two days later", "the next morning") into a seconds delta using these units.
{%- endif %}`,
  user: `Known entities, referenced only by the ID shown below in brackets — write it without the brackets, never invent one:
{%- assign referenceable = entities | active -%}
{%- assign stagedEntities = entities | staged -%}
{% for e in referenceable %}
- [{{ e.id }}] {{ e.name }} ({{ e.kind }})
{%- endfor %}
{% for e in stagedEntities %}
- [{{ e.id }}] {{ e.name }} ({{ e.kind }}, staged)
{%- endfor %}
{% if referenceable.size == 0 and stagedEntities.size == 0 %}(none)
{% endif %}
{%- comment -%}
Marking is mandatory, not stylistic (piggyback.md), and aimed at the memory blocks: older and
bulkier than the entries. The scene sections are the baseline, so they are framed, not fenced off.
{%- endcomment %}
Everything from here to "# This turn" is the world as it stands going into that turn — the baseline your report starts from, not a record of anything that happened in it.
Take the changes from the turn below; nothing above it happened this turn.

{% comment -%}
The scene sections mirror the narrator's (per-turn.ts), ids always: the roster is the ids'
source, and a section that shows state without one leaves the model matching by name.
{%- endcomment -%}
{%- assign inScene = '' | split: ',' -%}
{%- for e in referenceable -%}
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
## {{ e.name }} [{{ e.id }}]{% if e.description != blank %}
{{ e.description }}{% endif %}{% include 'macro_entity_state', e: e, here: true, ids: true %}
{% endfor %}
{% endif -%}
{% if structuralLocation -%}
# Current location

[{{ structuralLocation.id }}] {{ structuralLocation.name }}{% if currentLocationChain.size > 0 %} — in {{ currentLocationChain | join: ' › ' }}{% endif %}{% if structuralLocation.description != blank %}: {{ structuralLocation.description }}{% endif %}{% include 'macro_entity_state', e: structuralLocation, here: true, ids: true %}{% if looseItems.size > 0 %}
Here:{% for i in looseItems %}{% include 'macro_item_line', item: i, condition: i.state.condition, ids: true %}{% endfor %}{% endif %}

{% endif -%}
{% if locationMap.size > 0 or locationMapUnplaced.size > 0 -%}
# Places
{% for p in locationMap %}{% for d in (1..p.depth) %}  {% endfor %}{% if p.retired %}{{ p.name }} (retired{% if p.retiredReason %}: {{ p.retiredReason }}{% endif %}){% else %}[{{ p.id }}] {{ p.name }}{% endif %}
{% endfor %}{% if locationMapUnplaced.size > 0 %}Unplaced:
{% for p in locationMapUnplaced %}  {% for d in (1..p.depth) %}  {% endfor %}{% if p.retired %}{{ p.name }} (retired{% if p.retiredReason %}: {{ p.retiredReason }}{% endif %}){% else %}[{{ p.id }}] {{ p.name }}{% endif %}
{% endfor %}{% endif %}
{% endif -%}
{% include 'macro_memory_blocks', ids: true -%}
{%- comment -%}
piggyback.md → Fallback classifier context: a character the turn names whom nothing above
shows with state is still a roster id a write can name, so it shows the values a write replaces.
{%- endcomment -%}
{% if namedCharacters.size > 0 -%}
# Named in this turn — not necessarily present
{% for e in namedCharacters %}
[{{ e.id }}] {{ e.name }}{% if e.description != blank %}: {{ e.description }}{% endif %}{% include 'macro_entity_state', e: e, here: false, ids: true %}
{% endfor %}
{% endif -%}
{%- comment -%}
lastTurns is the knob's window over the pair (cadence.md → User-tunable knobs). Clamped because a
negative offset slices from the END in Liquid — coinciding with the intended rows, not meaning them.
{%- endcomment -%}
{%- assign pairStart = lastTurns | size | minus: 2 -%}
{%- if pairStart < 0 -%}{%- assign pairStart = 0 -%}{%- endif -%}
{% if pairStart > 0 -%}
# Earlier turns — how the scene got here, not the turn you report on
{% for entry in lastTurns limit: pairStart %}
{{ entry.content }}
{% endfor %}
{% endif -%}
# This turn
{% for entry in lastTurns offset: pairStart %}
{{ entry.content }}
{% endfor %}
Report the scene state as of the LAST entry above, the time delta, a one-sentence summary of the turn, up to three retrieval queries naming context you want looked up for the next turn, and anything else the schema asks for that this turn showed.
Scene state is absolute, not a delta: report the full cast present at the end of the turn, not only what changed. Read the entry before it for state the user's own action changed.
For the time delta, give {% if worldTimeDeltaBasis == 'sinceUserAction' %}seconds elapsed since the end of the user's action{% else %}seconds elapsed since the previous entry, including any time the user's action itself took{% endif %} (0 for a flashback or memory; never negative).

Report a place the scene settled in that has no ID yet in newLocations, and an item someone took or was given that has no ID yet in newItems. A handle is the one reference you make up: give each a handle that starts with new: (e.g. new:docks), and use it like an ID — a new place as currentLocation or as another new place's parent, a new item as a transfer's item id or, when it is in the scene, in sceneEntities.

Create a place only when the scene settles somewhere with its own identity the story could come back to: a named place, a building, a room that matters, a stretch of wild land where things happen. Don't create one for passing through (a corridor, a doorway, the road between two places); keep the current location then. Use an existing place's ID whenever the scene is somewhere already in Places, and nest a new place under the place it's part of.

Create an item only when a character takes, receives or is given something that matters beyond this moment: a weapon, a key, a letter, a relic. Not food eaten on the spot, not money (use a stackable), not scenery.
{% if suggestionsFire -%}
{% include 'macro_suggestion_emission_json' %}
{%- endif -%}`,
}
