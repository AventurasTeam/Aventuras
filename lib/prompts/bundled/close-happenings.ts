import { MACRO_IDS } from '../ids'
import type { TemplateSources } from '../types'

// memory/chapter-close.md → 3e. Happenings reads no prose (C3): its system half is the shared
// instructions alone, and a turn is read through read_turns.
export const CLOSE_HAPPENINGS: TemplateSources = {
  system: `{% include '${MACRO_IDS.closeInstructions}' %}`,
  user: `# Your task: happenings

Code found the clusters of happenings below: in each, the happenings share most of their cast, occurred within a few turns of one another and read alike, so they may record one event more than once. For each cluster, decide whether its happenings should become one, and merge them with merge_happenings. You don't see the chapter here: read a turn with read_turns when a happening's text leaves you unsure, and a happening's stored fields with read_row.

- Merge into a composite when the happenings share their cast and their time and complete each other: phases of one event in order, one building on the other, or two sides of one event. Keep one and absorb the rest, and send keep's description rewritten whole to hold what each said ("X happened, then Y"), and a title when keep's no longer covers them.
- Delete a duplicate when one event was recorded twice in different words: keep the more detailed happening and absorb the other, sending no title or description, so keep's text stands.
- Keep them apart when their meaning differs ("Aria swore the oath" and "Aria broke it"), when different characters came to know of them, or when they are distinct beats of the story: make no call.
- Lean toward merging a tight cluster: a duplicate left now stays for good, and a composite keeps the facts. When you are unsure whether happenings belong together, keep them apart.
- One call per cluster. Merge everything in a cluster that belongs together in one call: a happening one of your merges kept can be kept again, never absorbed. keep and absorb come from the same cluster.
- What a merge does. keep takes the earliest turn among the merged happenings, everyone involved in any of them and each character's knowledge of any of them; if any was common knowledge, keep becomes so. The absorbed happenings are deleted.
- Turn ids. Never write a turn id such as t3 into a title or a description: cite turns only in "turns".

Each happening below shows its title, the turn it occurred at, its cast and its description as they stand: "" is blank. One marked common knowledge is known to every character.

# Clusters
{%- for cluster in closeHappeningClusters %}

## Cluster {{ forloop.index }}
{%- for h in cluster %}

### {{ h.id }}: {{ h.title | one_line }}{% if h.commonKnowledge %} (common knowledge){% endif %}
- occurred at: {{ h.turn }}
- cast: {% for c in h.cast %}{{ c.name | one_line }} ({{ c.id }}){% unless forloop.last %}, {% endunless %}{% else %}none{% endfor %}
- description: {{ h.description | json }}
{%- endfor %}
{%- endfor %}
{%- if closeWritesSoFar != blank %}

# Writes so far
What this close has written, in earlier tasks:
{{ closeWritesSoFar }}
{%- endif %}`,
}
