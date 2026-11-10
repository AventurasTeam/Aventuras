import type { TemplateSources } from '../types'
import { CLOSE_TASK_SYSTEM } from './close-instructions'

// memory/chapter-close.md → 3a. The rows show titles only, so an update reads its row first (C11).
export const CLOSE_LORE: TemplateSources = {
  system: CLOSE_TASK_SYSTEM,
  user: `# Your task: lore

Keep the story's lore true to this chapter, with create_lore and update_lore. A lore row holds what the story's world is or how it works: a world-rule, a magic system, a religion, a faction's charter, a cosmology, or the story's own terms. Lore is rare: most chapters establish none, and a chapter that establishes none needs no call.

- Establishes, not mentions. Write lore only when the turns explain how something works or what it is, never when they only mention it:
  - "Aria visited the temple of Vael." is an event, not lore.
  - "The temple of Vael is a relic of the Eldritch covenants, where blood-bound priests once communed with the Forgotten Hour through ritual exsanguination." explains a religious practice: lore.
  - "The Aetherium was acting up again." mentions without explaining: not lore.
  - "The Aetherium runs on the kinetic resonance of crystalline lattices; without daily harmonic tuning by the keepers, the entire grid faults within hours." explains a mechanism: lore.
- Not lore: what one character, place, item or faction is like; that is the row's own, kept by other tasks. A faction's charter, the rules it is founded on, is lore.
- Extend, don't duplicate. When the chapter establishes more about something a row below already holds, extend or correct that row with update_lore instead of creating a second, the user's rows included. Before creating, call read_row on any row whose title may cover the same thing. A create with a title a row already has is rejected.
- Read first. The rows below show only their titles: call read_row on a row before update_lore, so you see its body and keywords as they stand.
- Creates. At most {{ closeLoreLimits.creates }} new lore rows per chapter, across all its parts; {{ closeLoreLimits.left }} left. Past the cap a create is rejected: extend a row instead.
- Bodies. A body explains the rule in plain prose, stated as a standing fact of the world, not as what happened in the scene. A new row's body holds at most {{ closeLoreLimits.bodyChars }} characters, and an update may grow a body by at most {{ closeLoreLimits.bodyChars }} characters. update_lore sends a body whole: it replaces the stored one.
- Category. A short label for the kind of lore, such as magic-system or religion.
- Keywords. Give a new row the names and terms the prose uses for it. update_lore takes keywords as add and remove: add a term the chapter uses for the row, and remove only one that no longer fits. A term the user added can't be removed.
- Turn ids. Never write a turn id such as t3 into a title, body, category or keyword: cite turns only in "turns".

# Lore rows
{%- for row in closeLore %}
- {{ row.id }}: {{ row.title | one_line }}
{%- else %}
None yet.
{%- endfor %}
{%- if closeWritesSoFar != blank %}

# Writes so far
What this close has written, in earlier tasks:
{{ closeWritesSoFar }}
{%- endif %}`,
}
