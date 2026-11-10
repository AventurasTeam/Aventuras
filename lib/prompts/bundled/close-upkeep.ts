import type { TemplateSources } from '../types'
import { CLOSE_TASK_SYSTEM } from './close-instructions'

// memory/chapter-close.md → 3f, and 3b's bar on a description. Every row shows the fields its tools
// write, so the start counts them as read (C11).
export const CLOSE_UPKEEP: TemplateSources = {
  system: CLOSE_TASK_SYSTEM,
  user: `# Your task: upkeep

Keep the world's places, items and keywords true to this chapter, with update_place, update_item and set_keywords, and mark the happenings everyone has come to know with mark_common_knowledge. Write only what the cited turns show; a row the chapter leaves as it was needs no call.

- Off-scene conditions. Set a place's or an item's condition only when the chapter shows it changed while the scene was elsewhere ("news came that the capital burned"). The turns' own scene keeps the conditions it showed, so leave the condition of a row marked in the scene alone.
- Descriptions. Rewrite a place's or an item's description only when the chapter materially changes what it is, never for detail its condition or placement already carries. A blank description may be filled when the cited turns show it.
- Keywords. With set_keywords, add the names and aliases the chapter uses for a row, and a bare place's or item's first keywords. Remove only a term an AI added that no longer fits: a term the user added can't be removed.
- Placement. With update_place, set a place's parent when the chapter places it or moves it, or send top: true for an unplaced place that nothing on the map could contain. Read a parent with read_row before naming it.
- Common knowledge. Mark a happening with mark_common_knowledge only when the turns show outright that word of it has spread to everyone. A wrong mark makes every character aware of it.
- Other rows. For a row the chapter names that isn't below, find it with search_world and read it with read_row before writing to it.
- Turn ids. Never write a turn id such as t3 into a condition, a description or a keyword: cite turns only in "turns".

The rows below show the fields you may write, as they stand: "" is blank and [] an empty list. A place's placement is the place it sits inside, top level, or unplaced: known to exist, not where.

# Rows
{%- for r in closeUpkeepRows %}

## {{ r.id }}: {{ r.name | one_line }} ({% if r.kind == 'location' %}place{% else %}{{ r.kind }}{% endif %}{% if r.status != 'active' %}, {{ r.status }}{% endif %}, {% if r.inScene %}in the scene{% else %}off the scene{% endif %})
{%- if r.kind == 'location' or r.kind == 'item' %}
- description: {{ r.description | json }}
- condition: {{ r.condition | json }}
{%- endif %}
{%- if r.kind == 'location' %}
- placement: {{ r.placement }}
{%- endif %}
- keywords: {{ r.keywords | json }}
{%- else %}

None.
{%- endfor %}

# Happenings not yet common knowledge
{%- for h in closeUpkeepHappenings %}
- {{ h.id }}: {{ h.title | one_line }}
{%- else %}
None.
{%- endfor %}
{%- if closeWritesSoFar != blank %}

# Writes so far
What this close has written, in earlier tasks:
{{ closeWritesSoFar }}
{%- endif %}`,
}
