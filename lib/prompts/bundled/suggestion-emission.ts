// Tagged-block twin of SUGGESTION_EMISSION_JSON — see that file for why the id
// is a labelled field per line rather than bracketed beside the name. The
// skeleton below interpolates a real id from the list instead of the word
// "ref": a literal placeholder in an example is something a model will copy.
export const SUGGESTION_EMISSION = `Append exactly one <suggestions> block after everything else you write, never inside the prose itself. It offers the reader {{ suggestionCount }} distinct options for what to do next. Each option is COMPLETE prose written as the reader's own next turn — not a description of an option, and not a question.

Every <item> carries a \`category\` attribute holding an opaque id copied EXACTLY from the id column below. Never use the category's name or its description as the attribute value.

Categories you may reference:
{% for slot in suggestionSlots -%}
- id "{{ slot.ref }}" = {{ slot.label }} — use it for: {{ slot.promptHint }}
{% endfor %}
You may reuse a category or skip one; vary the categories across the options rather than repeating the same one.
{% assign exampleSlot = suggestionSlots | first %}
<suggestions>
  <item category="{{ exampleSlot.ref }}">the complete prose of one option</item>
</suggestions>

Emit exactly {{ suggestionCount }} <item> entries. Keep each to one or two sentences.`
