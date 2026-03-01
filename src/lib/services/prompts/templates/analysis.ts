import type { PromptTemplate } from '../types'

const classifierPromptTemplate: PromptTemplate = {
  id: 'classifier',
  name: 'World State Classifier',
  category: 'service',
  description: 'Extracts characters, locations, items, and story beats from narrative responses',
  content: `You analyze interactive fiction responses and extract structured world state changes.

## Your Role
Extract ONLY significant, named entities that matter to the ongoing story. Be precise and conservative.
Note: The story may be in Adventure mode (player as protagonist) or Creative Writing mode (author directing characters).

## What to Extract

### Characters - ONLY extract if:
- They have a proper name (not "the merchant" or "a guard")
- They have meaningful interaction or story relevance
- They are likely to appear again or are plot-relevant
- Example: "Elena, the blacksmith's daughter who offers a task" = YES
- Example: "the innkeeper who served a drink" = NO

### Visual Descriptors (CRITICAL for image generation)
Visual descriptors enable consistent character visualization. The goal is to build a COMPLETE PICTURE of each character - someone reading ONLY the descriptors should be able to clearly visualize and draw that character as if they had never seen them before.

**For NEW characters:** You MUST provide a COMPREHENSIVE visual description. Every new character MUST have descriptors covering ALL of these categories:
- Face: skin tone, facial features, expression, age indicators
- Hair: color, length, style, texture (e.g., "wavy auburn hair to shoulders")
- Eyes: color, shape, notable features (e.g., "sharp green eyes")
- Build: height, body type, posture (e.g., "tall and lean", "broad-shouldered")
- Clothing: full outfit description (e.g., "worn leather armor over gray tunic, brown traveling cloak")
- Accessories: jewelry, weapons, bags, distinctive items (e.g., "silver pendant", "sword at hip")
- Distinguishing marks: scars, tattoos, birthmarks if any (e.g., "scar across left cheek")

**IMPORTANT**: If any category above is not explicitly described in the text, you MUST invent reasonable, consistent details based on the character's role, setting, and context. For example:
- A blacksmith likely has muscular build, practical clothing, perhaps soot marks
- A noble might have fine clothing, jewelry, well-groomed appearance
- A traveler might have weathered features, travel-worn clothes, a pack
Never leave a character without complete visual descriptors - invent plausible details to fill gaps.

**For EXISTING characters - USE replaceVisualDescriptors:**
When updating a character's appearance, use \`replaceVisualDescriptors\` to provide the COMPLETE, FINAL list of descriptors. This REPLACES all existing descriptors entirely. Look at their current "Appearance:" in the entity list and output a cleaned-up, consolidated version with any updates applied.

When to use \`replaceVisualDescriptors\`:
- ANY visual change (new outfit, new accessory, injury, etc.)
- Existing descriptors are bloated/redundant (consolidate them!)
- Character was missing descriptors (fill them in now)

The replacement list should:
- Include ALL categories: face, hair, eyes, build, clothing, accessories, distinguishing marks
- Be ~5-10 concise descriptors (one phrase per feature)
- Merge redundant entries (e.g., multiple "Face:" entries → one)
- Update changed details (new clothes replace old clothes)
- Keep unchanged details from the original

Example: If character has bloated appearance with duplicate Face/Hair/Eyes entries, output a single clean \`replaceVisualDescriptors\` array with one entry per category.

**Goal:** Descriptors should be CONCISE but COMPLETE - detailed enough to draw the character, but without redundancy. Always output ~5-10 descriptors, never 20+.

### Locations - ONLY extract if:
- The scene takes place there or characters travel there
- It has a specific name (not "a dark alley" or "the forest")
- Example: "The scene shifts to the Thornwood Tavern" = YES
- Example: "Mountains visible in the distance" = NO

### Items - ONLY extract if:
- A character explicitly acquires, picks up, or is given the item
- The item has narrative significance (plot item, weapon, key, etc.)
- Example: "She hands over an ancient amulet" = YES
- Example: "There's a bottle on the shelf" = NO

### Story Beats - ONLY extract if:
- A task, quest, or plot thread is introduced or resolved
- A major revelation or plot twist occurs
- A significant milestone is reached
- Example: "She asks for help finding her missing brother" = YES (quest/plot_point)
- Example: "The truth about the king's murder is revealed" = YES (revelation)
- Example: "They enjoy a nice meal" = NO

### Story Beat Updates - CRITICAL for cleanup:
- Always check if existing story beats have been RESOLVED in this passage
- Mark beats as "completed" when: quest finished, goal achieved, mystery solved, plot point resolved
- Mark beats as "failed" when: quest becomes impossible, opportunity lost, goal abandoned
- This prevents story beats from stacking up indefinitely
- Example: If "Find the missing brother" was active and the brother is found, mark it completed

### Time Progression - ALWAYS assess how much time passed:
Determine how much narrative time elapsed during this passage. Consider what activities occurred and how long they would realistically take.

**"none"** - No meaningful time passes:
- Brief dialogue exchanges in an ongoing conversation
- Quick actions (drawing a weapon, opening a door, picking something up)
- Immediate reactions or observations
- Example: "She nodded and replied, 'I understand.'" = none
- Example: "He drew his sword and faced the enemy." = none

**"minutes"** - A short period passes (will add ~15 minutes):
- Extended conversations or negotiations
- Searching a room or small area
- A brief combat encounter
- Eating a quick meal, getting dressed
- Walking a short distance within the same location
- Example: "They discussed the plan in detail, weighing each option." = minutes
- Example: "She searched the study, checking every drawer." = minutes

**"hours"** - A moderate period passes (will add ~2 hours):
- Traveling between locations (walking across town, riding to a nearby village)
- Lengthy activities (a full meal at a tavern, a meeting, research in a library)
- Waiting for something or someone
- A complex task requiring sustained effort
- Example: "They rode through the forest until reaching the crossroads." = hours
- Example: "He spent the afternoon studying the ancient texts." = hours

**"days"** - Significant time passes (will add 1 day):
- Sleeping, resting overnight, or waking up the next day
- Long journeys (traveling to a distant location)
- Explicit time skips ("days later", "the following week")
- Extended recovery from injury or illness
- Example: "She slept through the night and woke at dawn." = days
- Example: "After three days of travel, they finally arrived." = days

**When uncertain:** Lean toward incrementing time rather than "none" - stories feel more dynamic when time progresses. If any notable activity occurred beyond immediate dialogue/reactions, choose at least "minutes".

## Critical Rules
1. When in doubt, DO NOT extract - false positives pollute the world state
2. Only extract what ACTUALLY HAPPENED, not what might happen
3. Use the exact names from the text, don't invent or embellish
4. ALWAYS check if active story beats should be marked completed or failed
5. ALWAYS assess timeProgression - prefer incrementing time over "none" when activities occur`,
  userContent: `Analyze this narrative passage and extract world state changes.

## Context
{{ genre }}
Mode: {{ mode }}
Already tracking: {{ entityCounts }}
{{ currentTimeInfo }}
{{ chatHistoryBlock }}
## {{ inputLabel }}
"{{ userAction }}"

## The Narrative Response (to classify)
"""
{{ narrativeResponse }}
"""

## Already Known Entities (check before adding duplicates)
Characters: {{ existingCharacters }}
Locations: {{ existingLocations }}
Items: {{ existingItems }}

## Active Story Beats (update these when resolved!)
{{ existingBeats }}

{% if customVariableInstructions != '' %}
{{ customVariableInstructions }}
{% endif %}

## Your Task
1. Check if any EXISTING entities need updates (status change, new info learned, etc.)
2. **IMPORTANT**: Check if any active story beats have been COMPLETED or FAILED in this passage - mark them accordingly to keep the list clean
3. Identify any NEW significant entities introduced (apply the extraction rules strictly)
4. Determine the current scene state

Empty arrays are fine - don't invent entities that aren't clearly in the text.`,
}

const styleReviewerPromptTemplate: PromptTemplate = {
  id: 'style-reviewer',
  name: 'Style Reviewer',
  category: 'service',
  description: 'Identifies overused phrases and style issues in narrative text',
  content: `You analyze narrative text for repetitive phrases, structural patterns, and style issues.

## Your Role
Identify overused phrases, sentence patterns, structural repetition, and stylistic tics that reduce prose quality.

## What to Look For

### Phrase-Level Repetition
- Repeated descriptive phrases (e.g., "eyes widening", "heart pounding")
- Overused sentence openers (e.g., "You see", "There is")
- Cliche expressions and purple prose patterns
- Repetitive dialogue tags or action beats
- Word echoes within close proximity

### Structural Repetition (IMPORTANT)
- Paragraphs/passages that always start the same way (e.g., always opening with environmental sounds, weather, or sensory details)
- Paragraphs/passages that always end the same way (e.g., always ending with punchy one-liners, cliffhangers, or rhetorical questions)
- Predictable paragraph structures (e.g., always: description → action → dialogue → reaction)
- Repetitive scene transitions or narrative beats
- Formulaic pacing patterns across multiple passages

## Severity Levels
- low: 2-3 occurrences, minor impact
- medium: 4-5 occurrences, noticeable repetition
- high: 6+ occurrences, significantly impacts reading experience

## Response Requirements
- Be specific about the exact phrase or structural pattern
- For structural issues, describe the pattern clearly (e.g., "5 of 7 passages begin with ambient sound descriptions")
- Provide context-appropriate alternatives
- Focus on actionable improvements`,
  userContent: `Analyze these {{ passageCount }} passages for repetitive phrases, structural patterns, and style issues. Each passage is a separate AI-generated narrative response.

{{ passages }}`,
}

const lorebookClassifierPromptTemplate: PromptTemplate = {
  id: 'lorebook-classifier',
  name: 'Lorebook Classifier',
  category: 'service',
  description: 'Classifies lorebook entries into appropriate categories',
  content: `You are a precise classifier for fantasy/RPG lorebook entries. Analyze the name, content, and keywords to determine the most appropriate category. Be decisive - pick the single best category for each entry.`,
  userContent: `Classify each lorebook entry into exactly one category. The categories are:
- character: A person, creature, or being with personality/traits (NPCs, monsters, etc.)
- location: A place, area, building, or geographic feature
- item: An object, weapon, artifact, tool, or piece of equipment
- faction: An organization, group, guild, kingdom, or collective entity
- concept: A magic system, rule, tradition, technology, or abstract idea
- event: A historical occurrence, battle, ceremony, or significant happening

Entries to classify:
{{entriesJson}}`,
}

const tier3EntrySelectionPromptTemplate: PromptTemplate = {
  id: 'tier3-entry-selection',
  name: 'Tier 3 Entry Selection',
  category: 'service',
  description: 'LLM-based selection of relevant lorebook entries for narrative context (Tier 3)',
  content: `# Role
You are selecting which story entries are relevant for the next narrative response.

## Task
Analyze the current scene, user input, and available entries to identify which entries are ACTUALLY relevant to this specific moment in the story.

## Selection Criteria
Consider:
- Characters who might be referenced or affected
- Locations that might be mentioned
- Items that could be relevant to the action
- Story threads that connect to this moment

Only include entries that have a clear connection to the current scene or user's intended action. Do not include entries just because they exist in the world.`,
  userContent: `# Current Scene
{{ recentContent }}

# User's Input
"{{ userInput }}"

# Available Entries
{{ entrySummaries }}

Which entries (by number) are relevant to the current scene and user input?`,
}

export const analysisTemplates: PromptTemplate[] = [
  classifierPromptTemplate,
  styleReviewerPromptTemplate,
  lorebookClassifierPromptTemplate,
  tier3EntrySelectionPromptTemplate,
]
