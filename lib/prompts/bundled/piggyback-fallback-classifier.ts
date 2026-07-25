export const PIGGYBACK_FALLBACK_CLASSIFIER = `Known entities, referenced only by the ID shown below in brackets — write it without the brackets, never invent one:
{%- assign referenceable = entities | active -%}
{%- assign stagedEntities = entities | staged -%}
{% for e in referenceable %}
- [{{ e.id }}] {{ e.name }} ({{ e.kind }})
{%- endfor %}
{% for e in stagedEntities %}
- [{{ e.id }}] {{ e.name }} ({{ e.kind }}, staged)
{%- endfor %}
{% if referenceable.size == 0 and stagedEntities.size == 0 %}(none){% endif %}

Extract scene state from this turn:

{% for entry in entries %}
{{ entry.content }}
{% endfor %}
{% if suggestionsFire -%}
Also populate the "suggestions" field of your JSON response with exactly {{ suggestionCount }} distinct entries, one per next-turn option. Each entry's \`text\` is COMPLETE prose written as the reader's own next turn — not a description of an option, and not a question. Categories are listed below with a bracketed ref, e.g. "[cat1] Action" — reference that ref below WITHOUT the brackets, as the \`categoryRef\` value. You may reuse a category or skip one; vary the categories across entries rather than repeating the same one:
{% for slot in suggestionSlots -%}
- [{{ slot.ref }}] {{ slot.label }}: {{ slot.promptHint }}
{% endfor %}
Keep each entry's text to one or two sentences.
{%- endif -%}`
