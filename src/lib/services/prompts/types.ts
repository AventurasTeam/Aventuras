/** Prompt template category */
export type PromptCategory = 'story' | 'service' | 'wizard' | 'image-style'

/** Prompt template definition with Liquid syntax content resolved at runtime via ContextBuilder. */
export interface PromptTemplate {
  id: string
  name: string
  category: PromptCategory
  description: string
  /** System prompt content with Liquid template syntax. */
  content: string
  /** Optional user message template with Liquid template syntax. */
  userContent?: string
}
