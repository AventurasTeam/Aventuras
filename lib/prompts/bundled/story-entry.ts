// staticContent: reads only `entry` and `ids`. Marks the user's turns, bounded so a long turn ends
// where the tag does, and a turn's lead mark on a line before it (architecture.md → System and user
// halves). `ids`, passed at every include: false (no id), 'bracketed' ([c1] Name) or 'bare' (Name (c1)).
export const STORY_ENTRY = `{% if entry.leadMark %}(From this turn on, {% if entry.leadMark.gone %}"I" and "you" are a character no longer in the story and none of those named here, so credit what they do to no one.{% elsif entry.leadMark.none %}the story had no lead.{% else %}"I" and "you" are {% if ids == 'bracketed' %}[{{ entry.leadMark.id }}] {% endif %}{{ entry.leadMark.name }}{% if ids == 'bare' %} ({{ entry.leadMark.id }}){% endif %}.{% endif %})
{% endif %}{% if entry.kind == 'user_action' %}<user_turn>
{{ entry.content }}
</user_turn>{% else %}{{ entry.content }}{% endif %}`

// The narrator's and the refresh's line on reading the marks, under Story so far when a turn is
// marked. It never says the last run is the current lead's: after a set with no turn since, it isn't.
export const LEAD_MARK_EXPLAINER = `In the story so far, a line "(From this turn on, …)" before a turn says who "I" and "you" are from that turn until the next such line, whatever the instructions say; before the first such line, they are who the instructions say. What you write now follows the instructions.`
