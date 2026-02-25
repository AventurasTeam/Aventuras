import type { PromptTemplate } from '../types'

const suggestionsTemplate: PromptTemplate = {
  id: 'suggestions',
  name: 'Story Suggestions',
  category: 'service',
  description: 'Generates story direction suggestions for creative writing mode',
  content: `You are a creative writing assistant that suggests overall story directions and plot developments. Focus on where the narrative could go—scenes, plot beats, revelations, confrontations—NOT singular character actions like "she picks up the cup." Think like a story editor suggesting arcs, not a player suggesting moves.

IMPORTANT: Format each suggestion as an author's direction that the user would type to guide the AI. Use the style: "Continue the scene, having [character] do [action], and [additional direction]..."

Examples:
- "Continue the scene, having Marcus confront Elena about the missing documents, escalating into a heated argument"
- "Continue with the group discovering the abandoned cabin, but something feels wrong about it"
- "Have the protagonist finally reveal their secret to their companion, leading to an unexpected reaction"

These should read like instructions an author gives to guide the next part of the story.`,
  userContent: `Based on the current story moment, suggest 3 distinct directions the overall narrative could develop.

## Recent Story Content
"""
{{ recentContent }}
"""

## Active Story Threads
{{ activeThreads }}

{{ genre }}{{ lorebookContext }}

## Your Task
Generate 3 STORY DIRECTION suggestions. These should be plot developments, scene ideas, or narrative beats—NOT singular character actions.

IMPORTANT: Suggestions should be REASONABLE and GROUNDED in what's already happening. Avoid wild twists, sudden genre shifts, or directions that feel disconnected from the current story momentum.

The 3 suggestions should follow this pattern:
1. **Straightforward continuation** - The most natural next beat; what would logically happen next given the current scene and momentum
2. **Moderate development** - A reasonable direction that advances the plot or deepens character dynamics
3. **Interesting possibility** - A more creative option, but still plausible given established story elements

BAD examples (too small\\action-focused):
- "She picks up the letter"
- "He draws his sword"
- "They walk to the door"

BAD examples (too wild\\disconnected):
- "Aliens suddenly invade" (in a medieval drama)
- "Everything was a dream"
- "A random new character appears with shocking news"

GOOD examples (grounded story directions):
- "The conversation shifts to the unspoken tension between them"
- "They arrive at their destination and must deal with an unexpected complication"
- "The truth about the earlier incident comes out naturally in discussion"
- "A character they were expecting finally shows up"

Each suggestion should be:
- A narrative direction or plot beat, not a character micro-action
- Grounded in the current story context and tone
- Specific enough to write toward, vague enough to allow creativity
- Appropriate to the established tone and genre`,
}

export const suggestionsTemplates: PromptTemplate[] = [suggestionsTemplate]
