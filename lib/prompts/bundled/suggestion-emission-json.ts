// The structured-output twin of SUGGESTION_EMISSION: same chip contract, asked
// for as a JSON field instead of a trailing tagged block. Two macros because
// there are two output contracts — the narrative fold appends <suggestions> to
// prose, while both structured surfaces (the per-turn fallback classifier and
// suggestion-refresh) populate a schema field. Shared so the framing rules,
// ref convention, diversity nudge, and length cap can't drift between them.
export const SUGGESTION_EMISSION_JSON = `Populate the "suggestions" field of your JSON response with exactly {{ suggestionCount }} distinct entries, one per option for what the reader does next. Each entry's \`text\` is COMPLETE prose written as the reader's own next turn — not a description of an option, and not a question. Categories are listed below with a bracketed ref, e.g. "[cat1] Action" — reference that ref below WITHOUT the brackets, as the \`categoryRef\` value. You may reuse a category or skip one; vary the categories across entries rather than repeating the same one:
{% for slot in suggestionSlots -%}
- [{{ slot.ref }}] {{ slot.label }}: {{ slot.promptHint }}
{% endfor %}
Keep each entry's text to one or two sentences.`
