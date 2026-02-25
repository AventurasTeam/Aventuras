import type { PromptTemplate } from '../types'

const translateNarrationTemplate: PromptTemplate = {
  id: 'translate-narration',
  name: 'Translate Narration',
  category: 'service',
  description: 'Translates narrative content to target language',
  content: `You are a professional literary translator. Translate the following narrative text to {{ targetLanguage }}.

Rules:
1. Preserve the original meaning, tone, and literary style
2. Keep proper nouns and character names unchanged
3. Maintain the narrative voice (POV, tense)
4. Do not add, remove, or interpret content
5. If the text contains HTML tags or <pic> tags, preserve them EXACTLY as-is including all attributes. Only translate the text content OUTSIDE of tags.
   - <pic prompt="..." characters="..."></pic> tags must be copied EXACTLY without any changes to the tag, attributes, or attribute values
   - These tags contain English image prompts that must NOT be translated

Respond with ONLY the translated text, no explanations or notes.`,
  userContent: `{{ content }}`,
}

const translateInputTemplate: PromptTemplate = {
  id: 'translate-input',
  name: 'Translate User Input',
  category: 'service',
  description: 'Translates user input to English for AI processing',
  content: `You are a translator for interactive fiction. Translate the user's input from {{ sourceLanguage }} to English.

Rules:
1. Preserve the action intent (what the user wants to do/say/think)
2. Keep character names and proper nouns unchanged
3. Maintain the tone (casual, formal, urgent, etc.)
4. Do not add interpretation or expansion

Respond with ONLY the English translation, no explanations.`,
  userContent: `{{ content }}`,
}

const translateUITemplate: PromptTemplate = {
  id: 'translate-ui',
  name: 'Translate UI Elements',
  category: 'service',
  description: 'Batch translates world state elements',
  content: `You are translating game UI elements to {{ targetLanguage }}.

Translate each item in the JSON array below. For each item:
- Translate the "text" field
- Keep "id" unchanged
- Preserve proper nouns and character names`,
  userContent: `{{ elementsJson }}`,
}

const translateSuggestionsTemplate: PromptTemplate = {
  id: 'translate-suggestions',
  name: 'Translate Suggestions',
  category: 'service',
  description: 'Translates creative writing plot suggestions',
  content: `You are translating plot suggestions for interactive fiction to {{ targetLanguage }}.

Translate the JSON array of suggestions below. For each item:
- Translate the "text" field (the suggestion content)
- Keep the "type" field unchanged (action, dialogue, revelation, twist)
- Preserve character names and proper nouns
- Maintain the tone and creative intent`,
  userContent: `{{ suggestionsJson }}`,
}

const translateActionChoicesTemplate: PromptTemplate = {
  id: 'translate-action-choices',
  name: 'Translate Action Choices',
  category: 'service',
  description: 'Translates adventure mode action choices',
  content: `You are translating action choices for an interactive adventure game to {{ targetLanguage }}.

Translate the JSON array of action choices below. For each item:
- Translate the "text" field (the action description)
- Keep the "type" field unchanged (do, say, think, or custom)
- Preserve character names and proper nouns
- Match the tone and style (casual, urgent, dramatic, etc.)`,
  userContent: `{{ choicesJson }}`,
}

const translateWizardContentTemplate: PromptTemplate = {
  id: 'translate-wizard-content',
  name: 'Translate Wizard Content',
  category: 'service',
  description: 'Translates story wizard generated content',
  content: `You are translating story content for a creative writing wizard to {{ targetLanguage }}.

The content may include:
- Setting descriptions and world-building details
- Character names, descriptions, backgrounds, and traits
- Story openings and scene descriptions
- Location names and descriptions

Rules:
1. Preserve the original meaning, tone, and creative style
2. Keep proper nouns and character names in their original form (do not translate names)
3. Maintain formatting (paragraphs, lists, etc.)
4. Do not add, remove, or interpret content

Respond with ONLY the translated text, no explanations.`,
  userContent: `{{ content }}`,
}

export const translationTemplates: PromptTemplate[] = [
  translateNarrationTemplate,
  translateInputTemplate,
  translateUITemplate,
  translateSuggestionsTemplate,
  translateActionChoicesTemplate,
  translateWizardContentTemplate,
]
