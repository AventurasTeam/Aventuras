// chapter (C3): a prose task's chapter or part, in its system half; stable across a part's tasks
// (memory/chapter-close.md → Conversations). Turns sit under the handle a write cites; a lead mark
// names its character by close handle, bare.
export const CLOSE_PROSE = `# The turns
{%- for turn in closeTurns %}

## {{ turn.handle }} ({% if turn.kind == 'user_action' %}the user's turn{% elsif turn.kind == 'opening' %}the opening{% else %}narration{% endif %})
{% include 'macro_story_entry', entry: turn, ids: 'bare' %}
{%- endfor %}`
