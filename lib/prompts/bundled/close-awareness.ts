import { MACRO_IDS } from '../ids'
import type { TemplateSources } from '../types'

// memory/chapter-close.md → 3d. No prose (C3): the system half is the shared instructions alone, a
// prefix of every prose task's. The rows, the chapter and the writes so far go in the user half,
// and no retrieval count goes anywhere.
export const CLOSE_AWARENESS: TemplateSources = {
  system: `{% include '${MACRO_IDS.closeInstructions}' %}`,
  user: `# Your task: awareness

Each row below is what one character knows of a happening, with its pin: decay_resistance, from 0 to 1. As chapters pass a happening fades from what a character recalls, and the pin slows that; at 1 it never fades. With set_pin, change a pin only where this chapter shows it clearly wrong: most rows need no call.

- This chapter's rows: what a character learned during this chapter. Raise a pin toward 1 when the happening turned out to carry the chapter, something that character's story now turns on. Lower it toward 0 when it was pinned high but proved incidental.
- Rows that keep coming up: from any chapter, recalled often while this chapter was played. Raise a pin when the happening still carries that character's story; otherwise leave it. Never lower one of these: a lower value is refused.
- Raise a pin by at most 0.2 in one call, never straight to 1: a bigger raise is refused, and a row that stays load-bearing climbs again at a later close.
- A row already pinned where it belongs needs no call: one near 1 that keeps coming up is already doing its job.
- Turns. No turn is shown here. Read the ones you need with read_turns: a row's "at" turn, or this chapter's turns, {{ closeChapterTurns.first }} to {{ closeChapterTurns.last }}. Cite only this chapter's turns in "turns". A row's "at" turn outside that range is from an earlier chapter: read it with read_turns, never cite it.
{%- if closeChapterSummary != blank %}

# This chapter
{{ closeChapterSummary }}
{%- endif %}

# Rows
{%- for g in closeAwarenessRows %}

## {{ g.happening.id }}: {{ g.happening.title | one_line }}
{%- for r in g.rows %}
- {{ r.id }}: {{ r.character.name | one_line }} ({{ r.character.id }}), pin {% if r.decayResistance == blank %}0 (unset){% else %}{{ r.decayResistance }}{% endif %}, {% if r.list == 'chapter' %}learned this chapter{% else %}keeps coming up{% endif %}{% if r.learnedAt != blank %}, at {{ r.learnedAt }}{% endif %}{% if r.source != blank %}, how: {{ r.source | one_line | json }}{% endif %}
{%- endfor %}
{%- endfor %}
{%- if closeWritesSoFar != blank %}

# Writes so far
What this close has written, in earlier tasks:
{{ closeWritesSoFar }}
{%- endif %}`,
}
