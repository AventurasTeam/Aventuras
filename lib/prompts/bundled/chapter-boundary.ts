import type { TemplateSources } from '../types'

// chapter-close.md → Phase 1. C3's normal rule: the system half is the rules alone, and every
// per-call input (the candidates, the lengths, the threads) sits in the user half.
export const CHAPTER_BOUNDARY: TemplateSources = {
  system: `You are closing a chapter of an ongoing story. The open chapter has run long enough to end, and the turns listed below are where it could end at a sensible length, oldest first. Each is shown under its turn id (t1, t2…) and its position in the story, by the sentence it opens with and the one it ends on; a turn of one sentence shows only that one.

Pick the turn where the story comes to a natural ending: a scene changes, time skips ahead, a beat of its arc resolves, or the narrative pauses. The chapter ends with the turn you pick and the next one opens with the turn after it, so where a listed turn opens on a new scene or after a time skip, end on the listed turn before it. The active threads, when listed, help tell where an arc beat resolves.

- Answer with the turn id of one listed turn, exactly as it is shown. Never name a turn that isn't listed.
- Give one sentence on why the chapter ends there.`,
  user: `Pick the turn this chapter ends on.

# The open chapter
{{ boundaryRegionTokens }} tokens so far; a chapter runs about {{ boundaryThreshold }} tokens.
{%- if boundaryActiveThreads.size > 0 %}

# Active threads
{%- for thread in boundaryActiveThreads %}
- {{ thread.title }}
{%- endfor %}
{%- endif %}

# Candidate turns
{%- for candidate in boundaryCandidates %}

## {{ candidate.turn }} (position {{ candidate.position }})
Opens: {{ candidate.opening }}
{%- if candidate.closing %}
Ends: {{ candidate.closing }}
{%- endif %}
{%- endfor %}`,
}
