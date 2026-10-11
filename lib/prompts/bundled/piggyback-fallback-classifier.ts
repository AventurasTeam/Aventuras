// piggyback.md → Fallback classifier context: most of what the narrative call gets, minus
// Setting / Genre / Tone and either output-format macro, plus the flat bracketed ID roster.
export const PIGGYBACK_FALLBACK_CLASSIFIER = `Known entities, referenced only by the ID shown below in brackets — write it without the brackets, never invent one:
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

{% comment %}The second half of the condition de-dupes the row named as both in-scene and the
location; it is nil-safe, since a null structuralLocation makes it "e.id != nil". An item a
holder's Holds line names is not listed again (piggyback.md → What the writer sees).{% endcomment -%}
{%- assign heldIds = '' | split: ',' -%}
{%- for h in heldItems -%}{%- assign ids = h.items | map: 'id' -%}{%- assign heldIds = heldIds | concat: ids -%}{%- endfor -%}
{%- assign hasScene = false -%}
{%- for e in referenceable -%}
{%- if sceneEntities contains e.id and e.id != structuralLocation.id -%}{%- assign hasScene = true -%}{%- endif -%}
{%- endfor -%}
{% if hasScene -%}
# In scene
{% for e in referenceable -%}
{%- if sceneEntities contains e.id and e.id != structuralLocation.id -%}
{%- unless heldIds contains e.id %}
## {{ e.name }}{% if e.description != blank %}
{{ e.description }}{% endif %}{% for h in heldItems %}{% if h.holderId == e.id %}
Holds: {% for i in h.items %}[{{ i.id }}] {{ i.name }}{% if i.equipped %} (equipped){% endif %}{% unless forloop.last %}, {% endunless %}{% endfor %}{% endif %}{% endfor %}
{% endunless -%}
{%- endif -%}
{%- endfor %}

{% endif -%}
{% if structuralLocation -%}
# Current location

{{ structuralLocation.name }}{% if currentLocationChain.size > 0 %} — in {{ currentLocationChain | join: ' › ' }}{% endif %}{% if structuralLocation.description != blank %}: {{ structuralLocation.description }}{% endif %}{% if looseItems.size > 0 %}
Here: {% for i in looseItems %}[{{ i.id }}] {{ i.name }}{% unless forloop.last %}, {% endunless %}{% endfor %}{% endif %}

{% endif -%}
{% if locationMap.size > 0 -%}
# Places
{% for p in locationMap %}{% for d in (1..p.depth) %}  {% endfor %}[{{ p.id }}] {{ p.name }}
{% endfor %}
{% endif -%}
{% include 'macro_memory_blocks' -%}
{% if calendarVocabulary -%}
# Calendar
This story tracks time in {{ calendarVocabulary.baseUnitName }}s ({{ calendarVocabulary.secondsPerBaseUnit }} seconds per {{ calendarVocabulary.baseUnitName }}). Tiers: {% for t in calendarVocabulary.tiers %}{{ t.name }}{% if t.labels.size > 0 %} ({{ t.labels | prose_join }}){% endif %}{% unless forloop.last %}, {% endunless %}{% endfor %}. Convert relative-time prose ("two days later", "the next morning") into a seconds delta using these units.

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

Report a place the scene settled in that has no ID yet in newLocations, and an item someone took or was given that has no ID yet in newItems. A handle is the one reference you make up: give each a handle that starts with new: (e.g. new:docks), and use it like an ID — a new place as currentLocation or as another new place's parent, a new item as a transfer's item id.

Create a place only when the scene settles somewhere with its own identity the story could come back to: a named place, a building, a room that matters, a stretch of wild land where things happen. Don't create one for passing through (a corridor, a doorway, the road between two places); keep the current location then. Use an existing place's ID whenever the scene is somewhere already in Places, and nest a new place under the place it's part of.

Create an item only when a character takes, receives or is given something that matters beyond this moment: a weapon, a key, a letter, a relic. Not food eaten on the spot, not money (use a stackable), not scenery.
{% if suggestionsFire -%}
{% include 'macro_suggestion_emission_json' %}
{%- endif -%}`
