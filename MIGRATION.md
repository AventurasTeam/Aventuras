# Aventura Template Migration Guide

## Breaking Change: Deprecated Variables Removed (v1.2)

If you use **custom prompt templates** in Aventura, some template variables that were previously
supported have been removed. This guide shows how to update your templates.

The old pre-formatted string variables have been replaced by structured arrays and objects that
give your templates full control over formatting. The new variables have been available since
Aventura v1.1; the deprecated shim layer that bridged the two is now gone in v1.2.

---

## 1. `tieredContextBlock`

**What changed:** The old variable injected a pre-formatted world-state block (characters,
inventory, active threads, relevant locations) as a single opaque string. This is replaced by
four structured arrays you can iterate and format freely.

**Before:**
```liquid
{{ tieredContextBlock }}
```

**After:**
```liquid
{% if currentLocationObject %}
[CURRENT LOCATION]
{{ currentLocationObject.name }}
{% if currentLocationObject.description %}{{ currentLocationObject.description }}{% endif %}
{% endif %}

{% if worldStateCharacters.size > 0 %}
[KNOWN CHARACTERS]
{% for char in worldStateCharacters %}
• {{ char.name }}{% if char.relationship %} ({{ char.relationship }}){% endif %}{% if char.description %} - {{ char.description }}{% endif %}

{% endfor %}
{% endif %}

{% if worldStateInventory.size > 0 %}
[INVENTORY]
{% assign item_parts = "" %}
{% for item in worldStateInventory %}
  {% assign item_str = item.name %}
  {% if item.quantity > 1 %}{% assign item_str = item_str | append: " (×" | append: item.quantity | append: ")" %}{% endif %}
  {% if item.equipped %}{% assign item_str = item_str | append: " [equipped]" %}{% endif %}
  {% unless forloop.first %}{% assign item_parts = item_parts | append: ", " %}{% endunless %}
  {% assign item_parts = item_parts | append: item_str %}
{% endfor %}
{{ item_parts }}
{% endif %}

{% if worldStateBeats.size > 0 %}
[ACTIVE THREADS]
{% for beat in worldStateBeats %}
• {{ beat.title }}{% if beat.description %}: {{ beat.description }}{% endif %}

{% endfor %}
{% endif %}

{% if worldStateLocations.size > 0 %}
[RELEVANT LOCATIONS]
{% for loc in worldStateLocations %}
• {{ loc.name }}{% if loc.description %}: {{ loc.description }}{% endif %}

{% endfor %}
{% endif %}
```

**New variables available:**
- `worldStateCharacters[]` — each entry has `name`, `relationship`, `description`, `traits[]`, `appearance[]`, `tier`, `status`
- `worldStateInventory[]` — each entry has `name`, `description`, `quantity`, `equipped`
- `worldStateBeats[]` — each entry has `title`, `description`, `type`, `status`
- `worldStateLocations[]` — each entry has `name`, `description`, `visited`, `tier`

---

## 2. `chapterSummaries`

**What changed:** The old variable injected a pre-formatted `<story_history>` XML block. It is
replaced by two structured arrays: `chapters[]` for summarized chapters and `timelineFill[]` for
agentic retrieval results.

**Before:**
```liquid
{{ chapterSummaries }}
```

**After:**
```liquid
{% if chapters.size > 0 or timelineFill.size > 0 %}
<story_history>
## Previous Chapters
The following chapters have occurred earlier in the story. Use them for continuity and context.

{% for chapter in chapters %}
### Chapter {{ chapter.number }}{% if chapter.title %}: {{ chapter.title }}{% endif %}

{% if chapter.startTime and chapter.endTime %}*Time: {{ chapter.startTime }} → {{ chapter.endTime }}*
{% elsif chapter.startTime %}*Time: {{ chapter.startTime }}*
{% endif %}
{% if chapter.summary %}{{ chapter.summary }}{% endif %}

{% assign meta_parts = "" %}
{% if chapter.characters.size > 0 %}{% assign meta_parts = "Characters: " | append: chapter.characters | join: ", " %}{% endif %}
{% if chapter.locations.size > 0 %}
  {% assign loc_part = "Locations: " | append: chapter.locations | join: ", " %}
  {% if meta_parts != "" %}{% assign meta_parts = meta_parts | append: " | " %}{% endif %}
  {% assign meta_parts = meta_parts | append: loc_part %}
{% endif %}
{% if chapter.emotionalTone != "" %}
  {% assign tone_part = "Tone: " | append: chapter.emotionalTone %}
  {% if meta_parts != "" %}{% assign meta_parts = meta_parts | append: " | " %}{% endif %}
  {% assign meta_parts = meta_parts | append: tone_part %}
{% endif %}
{% if meta_parts != "" %}*{{ meta_parts }}*{% endif %}

{% endfor %}

{% if timelineFill.size > 0 %}
## Retrieved Context
The following information was retrieved from past chapters and is relevant to the current scene:

{% for item in timelineFill %}
{% if item.chapterNumbers.size == 1 %}**Chapter {{ item.chapterNumbers[0] }}**{% else %}**Chapters {{ item.chapterNumbers | join: ", " }}**{% endif %}

Q: {{ item.query }}
A: {{ item.answer }}

{% endfor %}
{% endif %}
</story_history>
{% endif %}
```

**New variables available:**
- `chapters[]` — each entry has `number`, `title`, `summary`, `startTime`, `endTime`, `characters[]`, `locations[]`, `emotionalTone`
- `timelineFill[]` — each entry has `query`, `answer`, `chapterNumbers[]`

---

## 3. `styleGuidance`

**What changed:** The old variable injected a pre-formatted `<style_guidance>` block with
writing style feedback. It is replaced by the `styleReview` object which you can format freely.

**Before:**
```liquid
{{ styleGuidance }}
```

**After:**
```liquid
{% if styleReview and styleReview.phrases.size > 0 %}

<style_guidance>
## Writing Style Feedback
Based on analysis of {{ styleReview.reviewedEntryCount }} recent entries:

{% for phrase in styleReview.phrases %}
- **"{{ phrase.phrase }}"** (used {{ phrase.frequency }} times, {{ phrase.severity }} severity)
  {% if phrase.alternatives.size > 0 %}Alternatives: {{ phrase.alternatives | join: ", " }}{% endif %}

{% endfor %}

Overall: {{ styleReview.overallAssessment }}
</style_guidance>
{% endif %}
```

**New variable available:**
- `styleReview` — object with `phrases[]` (each has `phrase`, `frequency`, `severity`, `alternatives[]`), `overallAssessment`, `reviewedEntryCount`

---

## 4. `lorebookContext`

**What changed:** The old variable injected a flat text list of lorebook entries. It is replaced
by `lorebookEntries[]` which you can iterate and format with full control.

**Before:**
```liquid
{{ lorebookContext }}
```

**After:**
```liquid
{% if lorebookEntries.size > 0 %}
{% for entry in lorebookEntries %}
{{ entry.name }}: {{ entry.description }}
{% endfor %}
{% endif %}
```

**New variable available:**
- `lorebookEntries[]` — each entry has `name`, `type`, `description`, `tier`, `disposition` (optional)

---

## 5. `retrievedChapterContext`

**What changed:** This was a text variable for agentic retrieval results. It has been renamed.

**Before:**
```liquid
{{ retrievedChapterContext }}
```

**After:**
```liquid
{{ agenticRetrievalContext }}
```

**New variable available:**
- `agenticRetrievalContext` — plain text string with Q&A results from agentic chapter retrieval

---

## 6. `inlineImageInstructions`

**What changed:** The old variable injected the full `<InlineImages>` instruction block as a
string. The instruction text is now embedded directly in the template, gated by the
`inlineImageMode` boolean.

**Before:**
```liquid
{{ inlineImageInstructions }}
```

**After:**
```liquid
{% if inlineImageMode %}
<InlineImages>
You can embed images directly in your narrative using the <pic> tag. Images will be generated
automatically where you place these tags.

**TAG FORMAT:**
<pic prompt="[detailed visual description]" characters="[character names]"></pic>

**ATTRIBUTES:**
- `prompt` (REQUIRED): A detailed visual description for image generation. Write as a complete
  scene description, NOT a reference to the text. **MUST ALWAYS BE IN ENGLISH**.
- `characters` (optional): Comma-separated names of characters appearing in the image.

**USAGE GUIDELINES:**
- Place <pic> tags AFTER the prose that describes the scene they illustrate
- Write prompts as detailed visual descriptions: subject, action, setting, mood, lighting, style
- Use sparingly: 1-3 images per response maximum
- Best used for: dramatic reveals, emotional peaks, new locations, important character moments

**CRITICAL RULES:**
- Prompts MUST be in English — image generation models only understand English
- The prompt must be a COMPLETE visual description — not a reference to the text
- Never place <pic> tags in the middle of a sentence
</InlineImages>
{% endif %}
```

**New variable available:**
- `inlineImageMode` — boolean, `true` when inline image generation is enabled for the story

---

## 7. `visualProseInstructions`

**What changed:** The old variable injected the full `<VisualProse>` instruction block. The
instruction text is now embedded directly in the template, gated by the `visualProseMode` boolean.

**Before:**
```liquid
{{ visualProseInstructions }}
```

**After:**
```liquid
{% if visualProseMode %}
<VisualProse>
You are also a visual artist with HTML5 and CSS3 at your disposal. Your entire response must be
valid HTML.

**OUTPUT FORMAT (CRITICAL):**
- Wrap ALL prose paragraphs in `<p>` tags
- Use `<span>` with inline styles for colored/styled text (dialogue, emphasis, actions)
- Use `<div>` with `<style>` blocks for complex visual elements (menus, letters, signs, etc.)
- NO plain text outside of HTML tags — everything must be wrapped

**FORBIDDEN:**
- Plain text without HTML tags (NO raw paragraphs — use `<p>`)
- Markdown syntax — use `<em>`, `<strong>`, or `<span>` with styles instead
- `position: fixed/absolute` — breaks the interface
- `<script>` tags — only HTML and CSS

**PRINCIPLES:**
- Purpose over flash — every visual choice serves the narrative
- Readability is paramount — never sacrifice text clarity for effects
</VisualProse>
{% endif %}
```

**New variable available:**
- `visualProseMode` — boolean, `true` when visual prose (HTML) mode is enabled for the story

---

## 8. `existingCharacters`

**What changed:** The old variable was a plain text list of characters. It is replaced by the
`characters[]` array (full character data) which you can format yourself.

**Before:**
```liquid
{{ existingCharacters }}
```

**After:**
```liquid
{% for char in characters %}
{{ char.name }} ({{ char.relationship }}): {{ char.description }}
{% endfor %}
```

**New variable available:**
- `characters[]` — each entry has `name`, `relationship`, `description`, `traits[]`, `appearance[]`

---

## 9. `existingBeats`

**What changed:** The old variable was a plain text list of story beats. It is replaced by the
`storyBeats[]` array with full beat data.

**Before:**
```liquid
{{ existingBeats }}
```

**After:**
```liquid
{% for beat in storyBeats %}
{{ beat.title }}: {{ beat.description }} ({{ beat.status }})
{% endfor %}
```

**New variable available:**
- `storyBeats[]` — each entry has `title`, `description`, `type`, `status`

---

## 10. `chatHistoryBlock`

**What changed:** The old variable was a pre-formatted text block of chat history. It is replaced
by `chatHistory[]`, a structured array you can iterate.

**Before:**
```liquid
{{ chatHistoryBlock }}
```

**After:**
```liquid
{% for entry in chatHistory %}
[{{ entry.type }}] {{ entry.content }}
{% endfor %}
```

**New variable available:**
- `chatHistory[]` — each entry has `type` (`narration`, `user_action`, etc.) and `content`

---

## 11. `passages` (text string → array)

**What changed:** The old `passages` variable was a pre-formatted text string of story passages
for style review. It is now a structured array of passage objects with the same name. If your
template uses `{{ passages }}` it will now render as `[object Object]` — update to iterate.

**Before:**
```liquid
{{ passages }}
```

**After:**
```liquid
{% for passage in passages %}
{{ passage.content }}

{% endfor %}
```

**New variable shape:**
- `passages[]` — each entry has `content` (the passage text), `entryId`, `type`

---

---

## 12. `characterDescriptors`

**What changed:** The old variable was a pre-formatted text block of all character visual
descriptors for image generation. It is replaced by the `sceneCharacters[]` array, which you
can iterate and format yourself — giving full control over which fields to render and how.

**Before:**
```liquid
{{ characterDescriptors }}
```

**After:**
```liquid
{%- for char in sceneCharacters %}{% if char.visualDescriptors %}
**{{ char.name }}**:
  {%- if char.visualDescriptors.face %}
  Face: {{ char.visualDescriptors.face }}
  {%- endif %}
  {%- if char.visualDescriptors.hair %}
  Hair: {{ char.visualDescriptors.hair }}
  {%- endif %}
  {%- if char.visualDescriptors.eyes %}
  Eyes: {{ char.visualDescriptors.eyes }}
  {%- endif %}
  {%- if char.visualDescriptors.build %}
  Build: {{ char.visualDescriptors.build }}
  {%- endif %}
  {%- if char.visualDescriptors.clothing %}
  Clothing: {{ char.visualDescriptors.clothing }}
  {%- endif %}
  {%- if char.visualDescriptors.accessories %}
  Accessories: {{ char.visualDescriptors.accessories }}
  {%- endif %}
  {%- if char.visualDescriptors.distinguishing %}
  Distinguishing features: {{ char.visualDescriptors.distinguishing }}
  {%- endif %}
{% endif %}{%- endfor %}
```

**New variable available:**
- `sceneCharacters[]` — each entry has `name`, `description`, `portrait`, and `visualDescriptors` (object with `face`, `hair`, `eyes`, `build`, `clothing`, `accessories`, `distinguishing`)

---

## 13. `charactersWithPortraits`

**What changed:** The old variable was a pre-formatted text list of characters that already have
portrait images. It is replaced by a Liquid filter on `sceneCharacters[]` that checks for the
presence of a `portrait` field.

**Before:**
```liquid
{{ charactersWithPortraits }}
```

**After:**
```liquid
{%- assign hasPortrait = false %}
{%- for char in sceneCharacters %}
  {%- if char.portrait %}
    {%- if hasPortrait %}, {% endif %}{{ char.name }}
    {%- assign hasPortrait = true %}
  {%- endif %}
{%- endfor %}
{%- unless hasPortrait %}None{% endunless %}
```

**New variable available:**
- `sceneCharacters[]` — filter by `char.portrait` being truthy to find characters with portraits

---

## 14. `charactersWithoutPortraits`

**What changed:** The old variable was a pre-formatted text list of characters that do not yet
have portrait images. It is replaced by a Liquid filter on `sceneCharacters[]` that checks for
the absence of a `portrait` field.

**Before:**
```liquid
{{ charactersWithoutPortraits }}
```

**After:**
```liquid
{%- assign hasNoPortrait = false %}
{%- for char in sceneCharacters %}
  {%- unless char.portrait %}
    {%- if hasNoPortrait %}, {% endif %}{{ char.name }}
    {%- assign hasNoPortrait = true %}
  {%- endunless %}
{%- endfor %}
{%- unless hasNoPortrait %}None{% endunless %}
```

**New variable available:**
- `sceneCharacters[]` — filter by `char.portrait` being falsy to find characters without portraits

---

## 15. `previousResponse`

**What changed:** The old variable was a plain text scalar containing the previous narrative
response for background image analysis. It is replaced by index arithmetic on the
`narrationEntries[]` array.

**Before:**
```liquid
##Previous Message:
{{ previousResponse }}
```

**After:**
```liquid
{% assign prevIdx = lastNarrationIndex | minus: 1 %}
##Previous Message:
{% if prevIdx >= 0 %}{{ narrationEntries[prevIdx].content }}{% endif %}
```

**New variables available:**
- `narrationEntries[]` — each entry has `type` (always `narration`) and `content`
- `lastNarrationIndex` — the index of the last entry (`narrationEntries.length - 1`)

---

## 16. `currentResponse`

**What changed:** The old variable was a plain text scalar containing the current narrative
response for background image analysis. It is replaced by direct index access on the
`narrationEntries[]` array using `lastNarrationIndex`.

**Before:**
```liquid
##Current Message:
{{ currentResponse }}
```

**After:**
```liquid
##Current Message:
{{ narrationEntries[lastNarrationIndex].content }}
```

**New variables available:**
- `narrationEntries[]` — each entry has `type` (always `narration`) and `content`
- `lastNarrationIndex` — the index of the last entry (`narrationEntries.length - 1`)

---

## 17. `chapterHistory`

**What changed:** The old variable was a pre-formatted string of the last 10 visible chat entries
(ACTION/NARRATIVE labels joined with double newlines). It is replaced by the `storyEntries[]`
structured array — the template now controls the window size and formatting.

**Before:**
```liquid
Visible chat history:
{{ chapterHistory }}
```

**After:**
```liquid
Visible chat history:
{% assign startIdx = storyEntries.size | minus: 10 %}
{%- if startIdx < 0 -%}{%- assign startIdx = 0 -%}{%- endif -%}
{% for entry in storyEntries limit: 10 offset: startIdx %}
[{% if entry.type == 'user_action' %}ACTION{% else %}NARRATIVE{% endif %}]: {{ entry.content }}
{% endfor %}
```

**New variable available:**
- `storyEntries[]` — each entry has `type` (`user_action` or `narration`) and `content`

---

## 18. `timeline`

**What changed:** The old variable was a pre-formatted string of chapter summaries
(`Chapter N: <summary>` lines joined with newlines). It is replaced by the `chapters[]`
structured array — the template now controls the formatting.

**Before:**
```liquid
Existing chapter timeline:
{{ timeline }}
```

**After:**
```liquid
Existing chapter timeline:
{% for chapter in chapters %}
Chapter {{ chapter.number }}: {{ chapter.summary | strip | default: 'No summary' }}
{% endfor %}
```

**New variable available:**
- `chapters[]` — each chapter has `number`, `title`, `summary`, `startTime`, `endTime`, and other fields

---

## 19. `chapterContent`

**What changed:** The old variable was a pre-formatted string of chapter content built by
concatenating chapter headers with either their full entry list or summary fallback. It is replaced
by the `answerChapters[]` structured array with dual-mode rendering — templates control whether to
show entries or summary.

**Before:**
```liquid
{{ chapterContent }}

QUESTION: {{ query }}
```

**After:**
```liquid
{% for chapter in answerChapters %}
## Chapter {{ chapter.number }}{% if chapter.title %}: {{ chapter.title }}{% endif %}

{% if chapter.entries.size > 0 %}
{%- for entry in chapter.entries %}
[{% if entry.type == 'user_action' %}ACTION{% else %}NARRATIVE{% endif %}]: {{ entry.content }}
{% endfor %}
{%- else %}
{{ chapter.summary }}
{%- endif %}
{% endfor %}

QUESTION: {{ query }}
```

**New variable available:**
- `answerChapters[]` — each item has `number`, `title`, `summary`, and optionally `entries[]`
  (each entry has `type` and `content`). `entries` is only present when full entry data was
  fetched; when absent, use `summary` as the fallback.

---

## Checking Your Templates

To find templates that reference deprecated variables, search for these strings in your custom
template content:

```
tieredContextBlock
chapterSummaries
styleGuidance
lorebookContext
retrievedChapterContext
inlineImageInstructions
visualProseInstructions
existingCharacters
existingBeats
chatHistoryBlock
characterDescriptors
charactersWithPortraits
charactersWithoutPortraits
previousResponse
currentResponse
chapterHistory
timeline
chapterContent
```

The Aventura template editor will render these as empty strings if referenced — no error will be
shown, but the output will be missing the expected content. Update each reference using the
before/after examples above.
