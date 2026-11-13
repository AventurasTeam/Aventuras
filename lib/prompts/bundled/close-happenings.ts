import { MACRO_IDS } from '../ids'
import type { TemplateSources } from '../types'

// memory/chapter-close.md → 3e. Happenings reads no prose (C3): its system half is the shared
// instructions alone, and a turn is read through read_turns.
export const CLOSE_HAPPENINGS: TemplateSources = {
  system: `{% include '${MACRO_IDS.closeInstructions}' %}`,
  user: `# Your task: happenings

Code found the clusters of happenings below. Every happening in a cluster passed three checks against each of the others: most of its cast shared, occurred within a few turns, and reads alike. Some of them may record one event more than once; a cluster may also hold more than one event, or a happening that belongs with none of the others. Decide which belong together and merge each event's happenings with merge_happenings. You don't see the chapter here: read a turn with read_turns when a happening's text leaves you unsure, and a happening's stored fields with read_row.

- Merge into a composite when the happenings share their cast and their time and complete each other: phases of one event in order, one building on the other, or two sides of one event. Keep the happening whose title covers the others best and absorb the event's others; send keep's description rewritten whole to hold what each said ("X happened, then Y"), and a title when keep's no longer covers them.
- Delete a duplicate when one event was recorded twice in different words: keep the more detailed happening and absorb the other, sending no title or description, so keep's text stands.
- Keep them apart when one reverses or contradicts the other ("Aria swore the oath" and "Aria broke it"), or when each is a beat that matters to the story on its own: make no call.
- Keep them apart when the merge would tell someone something new: everyone who knows any merged happening comes to know all of them, and every character does if one is common knowledge. So when one is common knowledge and another is not, or someone knows one but not another, merge only when the happening fewer characters know adds nothing to the one more characters know; when neither list holds the other, merge only a duplicate that adds nothing either way.
- Lean toward merging. Every cluster already passed the three checks, so take them as given; a duplicate left now stays for good, and a composite keeps the facts. When you are unsure whether happenings belong together, keep them apart.
- One call per event. Merge everything that records one event in one call, never in a chain. If you missed one, a happening a merge kept can be kept again, but never absorbed. keep and absorb come from the same cluster.
- What a merge does. keep takes the earliest turn among the merged happenings, everyone involved in any of them and each character's knowledge of any of them; if any was common knowledge, keep becomes so. The absorbed happenings are deleted.
- Turn ids. Never write a turn id such as t3 into a title or a description: cite turns only in "turns", and cite the turns the merged happenings occurred at.

Each happening below shows its title, the turn it occurred at, its cast, who knows it and its description as they stand: "" is blank. One marked common knowledge is known to every character.

# Clusters
{%- for cluster in closeHappeningClusters %}

## Cluster {{ forloop.index }}
{%- for h in cluster %}

### {{ h.id }}: {{ h.title | one_line }}{% if h.commonKnowledge %} (common knowledge){% endif %}
- occurred at: {{ h.turn }}
- cast: {% for c in h.cast %}{{ c.name | one_line }} ({{ c.id }}){% unless forloop.last %}, {% endunless %}{% else %}none{% endfor %}
- known by: {% if h.commonKnowledge %}every character{% else %}{% for c in h.knownBy %}{{ c.name | one_line }} ({{ c.id }}){% unless forloop.last %}, {% endunless %}{% else %}none{% endfor %}{% endif %}
- description: {{ h.description | json }}
{%- endfor %}
{%- endfor %}
{%- if closeWritesSoFar != blank %}

# Writes so far
What this close has written, in earlier tasks:
{{ closeWritesSoFar }}
{%- endif %}`,
}
