import type { TemplateSources } from '../types'

// architecture.md → System and user halves: the mode sits in the system half; the chapter, prior
// summary and threads are per call. Mode paragraph: classifier-mode-rule.ts's, worded for a summary.
export const CHAPTER_METADATA: TemplateSources = {
  system: `You are closing a chapter of an ongoing story. Read the whole chapter below and give it a title, a summary, a theme and keywords. Report only what the chapter's prose supports; never invent.

- Title. A few words naming the chapter, as a book's chapter heading would ("The duel at the mill"). Not a number, and not the story's own title.
- Summary. Two to four sentences telling what happened in this chapter, in order: who did what, what changed, and where it left things. Name characters and places as the prose names them, and tell it in the narration's own person: if the prose says "you", so does the summary. Later chapters recall this one through its summary alone, so keep what the story will need.
- Theme. A short tag for what the chapter is about beneath its events, in a word or two ("betrayal", "first contact").
- Keywords. Three to eight words or short phrases a reader would browse the chapter by: its key characters, places, objects and events.

The user's turns are marked with <user_turn> tags.
{%- if mode == 'adventure' %} Each is what the lead does, says or attempts; outside quoted speech, its "I" is the lead, as "you" is in narration told in the second person. Where the narration after a turn shows how an attempt turned out, the narration decides what happened, and what the lead says stands unless the narration contradicts it. A turn that plainly speaks to the narrator rather than playing the lead ("skip to the next morning") is a direction: it states nothing that happened, so take the facts from the narration.
{%- else %} Each is a direction or prose. One that reads as a direction ("the guards catch them at the gate") states nothing that happened: take the facts from the narration that carries it out. One that reads as prose is part of the story: summarize it like the narration.
{%- endif %}

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
