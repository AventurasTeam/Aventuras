import type { TemplateSources } from '../types'
import {
  CHAPTER_CONTINUITY_SECTIONS,
  CHAPTER_THEME_AND_KEYWORDS_RULES,
  CHAPTER_TITLE_RULE,
  chapterContinuityRule,
} from './chapter-metadata'

// chapter-close.md → Phase 2: the last call for a chapter in parts, from the parts' summaries. It
// reads no turn, so it takes no mode; the summaries, prior summary and threads are per call.
export const CHAPTER_METADATA_MERGE: TemplateSources = {
  system: `You are closing a chapter of an ongoing story. The chapter was too long to read at once, so each of its parts was summarized in turn, and those summaries are below, in the chapter's order. From them, give the whole chapter a title, a summary, a theme and keywords. Report only what the summaries support; never invent.

${CHAPTER_TITLE_RULE}
- Summary. Two to four sentences telling what happened across the whole chapter, in order: who did what, what changed, and where it left things. Name characters and places as the summaries name them, and keep the person they are told in: if they say "you", so does the summary. Later chapters recall this one through its summary alone, so keep what the story will need.
${CHAPTER_THEME_AND_KEYWORDS_RULES}

${chapterContinuityRule('this chapter')}`,
  user: `Give the chapter its title, summary, theme and keywords from the summaries of its parts.

${CHAPTER_CONTINUITY_SECTIONS}
# The chapter's parts
{%- for summary in partSummaries %}

## Part {{ forloop.index }}
{{ summary }}
{%- endfor %}`,
}
