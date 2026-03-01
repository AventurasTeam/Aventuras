import type { PromptTemplate } from '../types'

const actionChoicesPromptTemplate: PromptTemplate = {
  id: 'action-choices',
  name: 'Action Choices',
  category: 'service',
  description: 'Generates RPG-style action choices for the player based on current narrative',
  content: `You are an RPG game master generating action choices for a player. The player has a character/persona that represents THEM in the story - when you generate choices, these are suggestions for what the PLAYER (the real person) might want their character to do next. Generate action options that fit the current narrative moment and MATCH THE PLAYER'S WRITING STYLE - if they write verbose actions, generate verbose choices; if they write terse commands, generate terse choices. Mimic their vocabulary, phrasing, and tone.`,
  userContent: `Based on the current story moment, generate 3-4 RPG-style action choices.

## CRITICAL: Who is the Player?
The USER is playing as {{ protagonistName }}{{ protagonistDescription }}. This is the USER'S persona/character - it IS the user, not a separate NPC.
When generating action choices, you are suggesting what THE USER might want to do next as their character {{ protagonistName }}.
Do NOT generate actions for {{ protagonistName }} as if they were a separate character - these are suggestions for the user's next move.
{{ styleGuidance }}

## Current Narrative
"""
{{ narrativeResponse }}
"""

## Recent Context
{{ recentContext }}

## Current Scene
Location: {{ currentLocation }}
NPCs Present: {{ npcsPresent }}
{{ protagonistName }}'s Inventory: {{ inventory }}
Active Quests: {{ activeQuests }}
{{ lorebookContext }}
## Your Task
Generate 3-4 distinct action choices for THE USER (playing as {{ protagonistName }}). Think like an RPG:
- **Every choice should move the plot forward** - no passive waiting or stalling
- Include at least one physical action (examine, take, use, attack, etc.)
- If NPCs are present, include a dialogue option for the user to talk to them
- If there's an obvious next step or quest objective, include it
- Include an exploratory or investigative option that advances understanding

Avoid choices like "Wait and see" or "Do nothing" - each option should lead to meaningful story progression.

{{ povInstruction }}

{{ lengthInstruction }}

## Choice Types
- action: Physical actions (fight, take, use, give, etc.)
- dialogue: Speaking to someone
- examine: Looking at or investigating something
- move: Going somewhere or leaving`,
}

const timelineFillPromptTemplate: PromptTemplate = {
  id: 'timeline-fill',
  name: 'Timeline Fill',
  category: 'service',
  description: 'Generates queries to gather context from past chapters',
  content: `<role>
You are an expert narrative analyzer, who is able to efficiently determine what crucial information is missing from the current narrative.
</role>

<task>
You will be provided with the entirety of the current chapter, as well as summaries of previous chapters. Your task is to succinctly ascertain what information is needed from previous chapters for the most recent scene and query accordingly, as to ensure that all information needed for accurate portrayal of the current scene is gathered.
</task>

<constraints>
Query based ONLY on the information visible in the chapter summaries or things that may be implied to have happened in them. Do not reference current events in your queries, as the assistant that answers queries is only provided the history of that chapter, and would have no knowledge of events outside of the chapters queried. However, do not ask about information directly answered in the summaries. Instead, try to ask questions that 'fill in the gaps'. The maximum range of chapters (startChapter - endChapter) for a single query is 3, but you may make as many queries as you wish.
</constraints>`,
  userContent: `Visible chat history:
{{ chapterHistory }}

Existing chapter timeline:
{{ timeline }}

Identify what information from past chapters would help understand the current scene. Generate queries about specific chapters or chapter ranges. The maximum number of chapters per query is 3.`,
}

const timelineFillAnswerPromptTemplate: PromptTemplate = {
  id: 'timeline-fill-answer',
  name: 'Timeline Fill Answer',
  category: 'service',
  description: 'Answers specific questions about past chapter content',
  content: `You answer specific questions about story chapters. Be concise and factual. Only include information that directly answers the question. If the chapter doesn't contain relevant information, say "Not mentioned in this chapter."`,
  userContent: `{{ chapterContent }}

QUESTION: {{ query }}

Provide a concise, factual answer based only on the chapter content above. If the information isn't available in these chapters, say "Not mentioned in these chapters."`,
}

export const generationTemplates: PromptTemplate[] = [
  actionChoicesPromptTemplate,
  timelineFillPromptTemplate,
  timelineFillAnswerPromptTemplate,
]
