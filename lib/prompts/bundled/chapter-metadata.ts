import type { TemplateSources } from '../types'

// architecture.md → System and user halves: the metadata call follows the rule, so the system half
// is the instructions alone and the chapter, the summary before it and the threads are per call.
export const CHAPTER_METADATA: TemplateSources = {
  system: `You are closing a chapter of an ongoing story. Read the whole chapter below and give it a title, a summary, a theme and keywords. Report only what the chapter's prose supports; never invent.

- Title. A few words naming the chapter, as a book's chapter heading would ("The duel at the mill"). Not a number, and not the story's own title.
- Summary. Two to four sentences telling what happened in this chapter, in order: who did what, what changed, and where it left things. Name characters and places as the prose names them, and tell it in the narration's own person: if the prose says "you", so does the summary. Later chapters recall this one through its summary alone, so keep what the story will need.
- Theme. A short tag for what the chapter is about beneath its events, in a word or two ("betrayal", "first contact").
- Keywords. Three to eight words or short phrases a reader would browse the chapter by: its key characters, places, objects and events.

The user's turns are marked with <user_turn> tags: what the lead tries or says, or a direction for the story. The narration after a turn decides what happened, so take the facts from it.

The previous chapter's summary, when given, is there for continuity: don't retell it. The open threads, when given, are what the story is following: name one in the summary only when this chapter moves it.`,
  user: `{%- if previousChapterSummary != blank -%}
# The previous chapter
{{ previousChapterSummary }}

{% endif -%}
{%- if threads.size > 0 -%}
# Open threads
{%- for t in threads %}
- {{ t.title }} ({{ t.status }})
{%- endfor %}

{% endif -%}
# The chapter
{%- for entry in entries %}

{% include 'macro_story_entry', entry: entry %}
{%- endfor %}`,
}
