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
location; it is nil-safe, since a null structuralLocation makes it "e.id != nil".{% endcomment -%}
{%- assign hasScene = false -%}
{%- for e in referenceable -%}
{%- if sceneEntities contains e.id and e.id != structuralLocation.id -%}{%- assign hasScene = true -%}{%- endif -%}
{%- endfor -%}
{% if hasScene -%}
# In scene
{% for e in referenceable -%}
{%- if sceneEntities contains e.id and e.id != structuralLocation.id %}
## {{ e.name }}{% if e.description != blank %}
{{ e.description }}{% endif %}
{% endif -%}
{%- endfor %}

{% endif -%}
{% if structuralLocation -%}
# Current location

{{ structuralLocation.name }}{% if structuralLocation.description != blank %}: {{ structuralLocation.description }}{% endif %}

{% endif -%}
{% include 'macro_memory_blocks' -%}
{% if calendarVocabulary -%}
# Calendar
This story tracks time in {{ calendarVocabulary.baseUnitName }}s ({{ calendarVocabulary.secondsPerBaseUnit }} seconds per {{ calendarVocabulary.baseUnitName }}). Tiers: {% for t in calendarVocabulary.tiers %}{{ t.name }}{% if t.labels.size > 0 %} ({{ t.labels | prose_join }}){% endif %}{% unless forloop.last %}, {% endunless %}{% endfor %}. Convert relative-time prose ("two days later", "the next morning") into a seconds delta using these units.

{% endif -%}
{%- comment -%}
lastTurns is the knob's window over the pair (cadence.md → User-tunable knobs). Clamped because
a negative offset slices from the END in Liquid — coinciding with the intended rows, not meaning them.
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
{% if suggestionsFire -%}
{% include 'macro_suggestion_emission_json' %}
{%- endif -%}`
