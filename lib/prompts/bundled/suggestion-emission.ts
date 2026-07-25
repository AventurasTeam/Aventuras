export const SUGGESTION_EMISSION = `Append exactly one <suggestions> block offering the reader {{ suggestionCount }} distinct options for what to do next. Each option is COMPLETE prose written as the reader's own next turn — not a description of an option, and not a question.

Categories are listed below with a bracketed ref, e.g. "[cat1] Action" — reference that ref below WITHOUT the brackets, as the \`category\` attribute. You may reuse a category or skip one; vary the categories across the options rather than repeating the same one:
{% for slot in suggestionSlots -%}
- [{{ slot.ref }}] {{ slot.label }}: {{ slot.promptHint }}
{% endfor %}
<suggestions>
  <item category="ref">the complete prose of one option</item>
</suggestions>

Emit exactly {{ suggestionCount }} <item> entries. Keep each to one or two sentences.`
