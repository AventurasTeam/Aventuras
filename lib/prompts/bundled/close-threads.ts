import type { TemplateSources } from '../types'
import { CLOSE_TASK_SYSTEM } from './close-instructions'

// memory/chapter-close.md → 3f's Threads bullet; the merge keeps the kept row's status (3f). Merges
// come first: merge_threads refuses to absorb a thread this close already wrote.
export const CLOSE_THREADS: TemplateSources = {
  system: CLOSE_TASK_SYSTEM,
  user: `# Your task: threads

Keep the story's open threads true to this chapter. An active thread is carried in the narrator's prompt every turn until it closes, so a thread the chapter has settled or plainly abandoned shouldn't stay open. Write only what the cited turns show; a thread the chapter leaves as it was needs no call.

- Duplicates. With merge_threads, merge threads that follow the same goal, quest, mystery or threat, however worded: keep one and absorb the rest. Merge before you update: a thread this close already wrote can be kept, never absorbed. When one is active, keep an active one: an active thread can be absorbed only into another active one. Give a title or description only to replace the kept thread's; a duplicate the kept thread already covers merges with neither.
- Status. With update_thread, set "resolved" when the chapter achieves a thread, or "failed" when it makes the thread impossible or plainly abandons it, citing the turns that settle it.
- Descriptions. Bring a thread's description up to date when the chapter moves it on.
- Titles. A thread's title changes only in a merge.

The threads below show their titles, statuses and descriptions as they stand: "" is blank.

# Open threads
{%- for t in closeThreads %}

## {{ t.id }}: {{ t.title | one_line }} ({{ t.status }})
- description: {{ t.description | json }}
{%- endfor %}
{%- if closeWritesSoFar != blank %}

# Writes so far
What this close has written, in earlier tasks:
{{ closeWritesSoFar }}
{%- endif %}`,
}
