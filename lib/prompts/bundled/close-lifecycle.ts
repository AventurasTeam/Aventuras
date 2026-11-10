import type { TemplateSources } from '../types'
import { CLOSE_TASK_SYSTEM } from './close-instructions'

// memory/chapter-close.md → Phase 4 and 3f's collision bullet: hard finality only, never a place,
// and a duplicate flagged for the user, never merged.
export const CLOSE_LIFECYCLE: TemplateSources = {
  system: CLOSE_TASK_SYSTEM,
  user: `# Your task: lifecycle

Check the characters, items and factions below against this chapter. Most need no call: a row the chapter leaves in play stays active.

- Retirement. With retire_entity, retire a row only on hard finality the cited turns state outright: a death, an exile or other leaving the story for good, a destruction, a disbanding. A death the narration reports as fact counts, even off the scene; one a character only suspects or hears as rumour does not. A wound, a capture, a journey, an item lost, stolen or handed on, a faction beaten or scattered, or a row the chapter simply doesn't show is no finality: leave the row active. When the signal is weak, leave it active.
- Never a place. Only the user retires a place; retire_entity refuses one.
- The reason. Your why becomes the row's retirement reason, which the user reads: write it as one plain sentence on how the row left the story, naming no turn id.
- Duplicates. With flag_duplicate, flag two rows of one kind that the chapter shows are one person, place or thing under two names (the hooded stranger who turns out to be Kael), naming the row and the one it is the same as. The user decides whether to merge them; you never merge. A row whose flag names a third row refuses a new flag, and so does a pair the user already kept apart.
- Other rows. For a row the chapter names that isn't below, find it with search_world and read it with read_row before writing to it.

The rows below show the fields you may write, as they stand: "" is blank. A row's flag names the row it was flagged with, by id and name, and why; a dormant flag no longer holds and counts as none.

# Rows
{%- for r in closeLifecycleRows %}

## {{ r.id }}: {{ r.name | one_line }} ({{ r.kind }})
- status: {{ r.status | json }}
- retiredReason: {{ r.retiredReason | json }}
- flag: {% if r.collision == blank %}none{% else %}{{ r.collision }}{% endif %}
{%- endfor %}
{%- if closeWritesSoFar != blank %}

# Writes so far
What this close has written, in earlier tasks:
{{ closeWritesSoFar }}
{%- endif %}`,
}
