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
{% endfor %}`
