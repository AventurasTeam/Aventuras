import type { PromptTemplate } from '../types'
import { storyTemplates } from './narrative'
import { analysisTemplates } from './analysis'
import { memoryTemplates } from './memory'
import { suggestionsTemplates } from './suggestions'
import { generationTemplates } from './generation'
import { wizardTemplates } from './wizard'
import { translationTemplates } from './translation'
import { imageTemplates } from './image'

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  ...storyTemplates,
  ...analysisTemplates,
  ...memoryTemplates,
  ...suggestionsTemplates,
  ...generationTemplates,
  ...wizardTemplates,
  ...translationTemplates,
  ...imageTemplates,
]
