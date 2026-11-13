import type { TemplateSources } from '../types'
import {
  CHAPTER_CONTINUITY_SECTIONS,
  CHAPTER_TURN_RULE,
  chapterContinuityRule,
} from './chapter-metadata'

// chapter-close.md → Phase 2: one part of a chapter too long to send whole, summarized for the
// merge. The normal rule: the part, prior summary and threads are per call, in the user half.
export const CHAPTER_METADATA_PART: TemplateSources = {
  system: `You are closing a chapter of an ongoing story. The chapter is too long to read at once, so it is read in parts, and below is one of them. Summarize this part alone: a last step puts the parts' summaries together, in order, to name and summarize the whole chapter. Report only what this part's prose supports; never invent.

- Summary. Three to five sentences telling what happened in this part, in order: who did what, what changed, and where it left things. Name characters and places as the prose names them, and tell it in the narration's own person: if the prose says "you", so does the summary. The chapter's summary is made from these, so keep what the story will need.

${CHAPTER_TURN_RULE}

${chapterContinuityRule('this part')}`,
  user: `Summarize this part of the chapter.

${CHAPTER_CONTINUITY_SECTIONS}
# This part of the chapter
{%- for entry in entries %}

{% include 'macro_story_entry', entry: entry %}
{%- endfor %}`,
}
