import type { TemplateSources } from '../types'
import { CLOSE_TASK_SYSTEM } from './close-instructions'

// memory/chapter-close.md → 3b. Fields show as JSON, the shape the tool takes them back in, so a
// list resent unchanged reads as restated.
export const CLOSE_IDENTITY: TemplateSources = {
  system: CLOSE_TASK_SYSTEM,
  user: `# Your task: identity

Keep who the characters and factions below are true to this chapter, with update_character and update_faction: a character's traits, drives, voice and description, and a faction's agenda, standing and description. Write only what the cited turns show; a row the chapter leaves as it was needs no call.

- Lists. Send a list whole, as it should stand after the chapter: it replaces the stored one. The caps are {{ closeSoftCaps.traits }} traits, {{ closeSoftCaps.drives }} drives and {{ closeSoftCaps.agenda }} agenda items. A list can't be emptied: an empty list reads as left out, so a list's last entry stays.
  - Add an entry when the turns show a new trait, drive or agenda item.
  - Replace, don't append: at a cap, drop the entry the new one supersedes, or the one the chapter shows least, to make room, and say which in "why". A list over its cap is rejected unless it is no longer than the stored one.
  - Merge two entries that mean the same ("brave" and "courageous") into one, keeping the more general or the better evidenced spelling.
  - Remove an entry only when the chapter plainly contradicts it.
- Don't churn stable identity. An entry the chapter merely doesn't show stays: "brave" isn't removed because the chapter happened not to show bravery.
- Voice and standing. Rewrite a character's voice or a faction's standing whole when the chapter shows it changed.
- Descriptions. Rewrite a description only when the chapter materially changes who or what the row is (the stable boy who became the king's champion), never for detail its other fields already carry.
- Blank fields. A blank description, voice or standing may be filled when the cited turns show it.
- Other rows. For a character or faction the chapter names that isn't below, find it with search_world and read it with read_row before writing to it.

The rows below show the fields you may write, as they stand: "" is blank and [] an empty list.

# Characters
{%- for c in closeCharacters %}

## {{ c.id }}: {{ c.name | one_line }}{% if c.status != 'active' %} ({{ c.status }}){% endif %}
- description: {{ c.description | json }}
- traits: {{ c.traits | json }}
- drives: {{ c.drives | json }}
- voice: {{ c.voice | json }}
{%- else %}

None.
{%- endfor %}

# Factions
{%- for f in closeFactions %}

## {{ f.id }}: {{ f.name | one_line }}
- description: {{ f.description | json }}
- standing: {{ f.standing | json }}
- agenda: {{ f.agenda | json }}
{%- else %}

None.
{%- endfor %}
{%- if closeWritesSoFar != blank %}

# Writes so far
What this close has written, in earlier tasks:
{{ closeWritesSoFar }}
{%- endif %}`,
}
