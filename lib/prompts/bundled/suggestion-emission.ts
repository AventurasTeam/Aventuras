// Tagged-block twin of SUGGESTION_EMISSION_JSON — see that file for why the id
// is a labelled field per line rather than bracketed beside the name. The
// skeleton below interpolates a real id from the list instead of the word
// "ref": a literal placeholder in an example is something a model will copy.
export const SUGGESTION_EMISSION = `Append exactly one <suggestions> block after everything else you write, never inside the prose itself. It offers the user {{ suggestionCount }} distinct options for their next turn. Each option is a finished turn they could send as it is — not a description of an option, and not a question. {% include 'macro_suggestion_voice', mode: definition.mode, person: composerWrapPov, lead: lead.name %}

Every <item> carries a \`category\` attribute holding an opaque id copied EXACTLY from the id column below. Never use the category's name or its description as the attribute value.

Categories you may reference:
{% for slot in suggestionSlots -%}
- id "{{ slot.ref }}" = {{ slot.label }} — use it for: {{ slot.promptHint }}
{% endfor %}
You may reuse a category or skip one; vary the categories across the options rather than repeating the same one.
{% assign exampleSlot = suggestionSlots | first %}
<suggestions>
  <item category="{{ exampleSlot.ref }}">the text of one option</item>
</suggestions>

Emit exactly {{ suggestionCount }} <item> entries. Keep each to one or two sentences.`
