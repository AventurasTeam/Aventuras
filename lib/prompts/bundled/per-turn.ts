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
# In scene
{% for e in entities | active -%}
{%- if sceneEntities contains e.id %}
## {{ e.name }}{% if piggybackFires %} [{{ e.id }}]{% endif %}
{{ e.description }}
{% endif -%}
{%- endfor %}

{% endif -%}
{%- assign stagedList = entities | staged -%}
{% if stagedList.size > 0 -%}
# Staged characters (introduce when narratively appropriate)
{% for e in stagedList %}
- {% if piggybackFires %}[{{ e.id }}] {% endif %}{{ e.name }}: {{ e.description }}
{%- endfor %}
{% if piggybackFires -%}

If you introduce any staged character, include their ID (without brackets) in the trailing <scene_entities> block.
{% endif -%}

{% endif -%}
{%- assign locationList = entities | active | by_kind: 'location' -%}
{% if locationList.size > 0 -%}
# Known locations
{% for e in locationList %}
- {% if piggybackFires %}[{{ e.id }}] {% endif %}{{ e.name }}{% if e.description != blank %}: {{ e.description }}{% endif %}
{%- endfor %}
{% if piggybackFires -%}

Use one of these IDs (without brackets) for <current_location> if the scene is at one of them; leave it out if the scene moves somewhere not listed here.
{% endif -%}

{% endif -%}
{% if calendarVocabulary -%}
# Calendar
This story tracks time in {{ calendarVocabulary.baseUnitName }}s ({{ calendarVocabulary.secondsPerBaseUnit }} seconds per {{ calendarVocabulary.baseUnitName }}). Tiers: {% for t in calendarVocabulary.tiers %}{{ t.name }}{% if t.labels.size > 0 %} ({{ t.labels | prose_join }}){% endif %}{% unless forloop.last %}, {% endunless %}{% endfor %}.{% if piggybackFires %} Convert relative-time prose ("two days later", "the next morning") into a seconds delta on <world_time_delta> using these units.{% endif %}

{% endif -%}
# Story so far
{%- assign recentEntries = entries | recent: userSettings.partialChapterBuffer %}
{% for entry in recentEntries %}
{{ entry.content }}
{% endfor %}
{% include 'macro_output_format_narrative' %}
{% if piggybackFires -%}
{% include 'macro_state_emission' %}
{%- endif %}`
