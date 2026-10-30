// staticContent: reads only `entry`. Every history marks the user's turns the same way, bounded so
// a turn of several paragraphs ends where the tag does (architecture.md → System and user halves).
export const STORY_ENTRY = `{% if entry.kind == 'user_action' %}<user_turn>
{{ entry.content }}
</user_turn>{% else %}{{ entry.content }}{% endif %}`
