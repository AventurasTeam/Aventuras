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
Populate the "suggestions" field of your JSON response with exactly {{ suggestionCount }} distinct entries, one per option for what the reader does next. Each entry's \`text\` is COMPLETE prose written as the reader's own next turn — not a description of an option, and not a question. Categories are listed below with a bracketed ref, e.g. "[cat1] Action" — reference that ref below WITHOUT the brackets, as the \`categoryRef\` value. You may reuse a category or skip one; vary the categories across entries rather than repeating the same one:
{% for slot in suggestionSlots -%}
- [{{ slot.ref }}] {{ slot.label }}: {{ slot.promptHint }}
{% endfor %}
Keep each entry's text to one or two sentences.
{%- endif -%}
{%- if refreshGuidance != blank %}

The reader has already started writing their next turn:

{{ refreshGuidance }}

Build on that direction — take it further or offer variations of it — without repeating it back verbatim.
{%- endif -%}`
