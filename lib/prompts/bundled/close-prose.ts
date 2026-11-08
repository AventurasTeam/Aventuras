// chapter (C3): a prose task's chapter or part, in its system half after the instructions; stable
// across a part's tasks, not the story (memory/chapter-close.md → Conversations). Each turn sits
// under the handle a write cites, the user's marked as every history marks them.
export const CLOSE_PROSE = `# The turns
{%- for turn in closeTurns %}

## {{ turn.handle }} ({% if turn.kind == 'user_action' %}the user's turn{% elsif turn.kind == 'opening' %}the opening{% else %}narration{% endif %})
{% include 'macro_story_entry', entry: turn %}
{%- endfor %}`
