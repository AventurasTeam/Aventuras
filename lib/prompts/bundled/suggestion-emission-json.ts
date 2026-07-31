// The structured-output twin of SUGGESTION_EMISSION: same chip contract, asked
// for as a JSON field instead of a trailing tagged block. Two macros because
// there are two output contracts — the narrative fold appends <suggestions> to
// prose, while both structured surfaces (the per-turn fallback classifier and
// suggestion-refresh) populate a schema field. Shared so the framing rules,
// ref convention, diversity nudge, and length cap can't drift between them.
//
// The id is spelled out as its own labelled field on every line rather than
// bracketed beside the name: "[cat1] Action" reads as one label, and a model
// that picks the human-readable half emits a ref that resolves to nothing and
// gets its chip dropped.
export const SUGGESTION_EMISSION_JSON = `Populate the "suggestions" field of your JSON response with exactly {{ suggestionCount }} distinct entries, one per option for what the reader does next.

Each entry has exactly two fields:
- "categoryRef" — an opaque id copied EXACTLY from the id column below (e.g. "cat1"). Never the category's name, never its description.
- "text" — COMPLETE prose written as the reader's own next turn, not a description of an option and not a question.

Categories you may reference:
{% for slot in suggestionSlots -%}
- id "{{ slot.ref }}" = {{ slot.label }} — use it for: {{ slot.promptHint }}
{% endfor %}
You may reuse a category or skip one; vary the categories across entries rather than repeating the same one. Keep each entry's text to one or two sentences.`
