/**
 * Template Grouping Configuration
 *
 * Maps all prompt templates to named groups for left panel navigation
 * in the Vault prompt editor UI.
 */

import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates'
import type { PromptTemplate } from '$lib/services/prompts/types'

export interface TemplateGroup {
  name: string
  templates: PromptTemplate[]
}

/** Template IDs mapped to display group names */
const TEMPLATE_GROUP_MAP: Record<string, string> = {
  // Story Generation
  adventure: 'Story Generation',
  'creative-writing': 'Story Generation',

  // Analysis
  classifier: 'Analysis',
  'style-reviewer': 'Analysis',
  'lorebook-classifier': 'Analysis',
  'tier3-entry-selection': 'Analysis',

  // Memory
  'chapter-analysis': 'Memory',
  'chapter-summarization': 'Memory',
  'retrieval-decision': 'Memory',
  'lore-management': 'Memory',
  'interactive-lorebook': 'Memory',
  'agentic-retrieval': 'Memory',

  // Suggestions & Actions
  suggestions: 'Suggestions & Actions',
  'action-choices': 'Suggestions & Actions',
  'timeline-fill': 'Suggestions & Actions',
  'timeline-fill-answer': 'Suggestions & Actions',

  // Image
  'image-style-soft-anime': 'Image',
  'image-style-semi-realistic': 'Image',
  'image-style-photorealistic': 'Image',
  'image-prompt-analysis': 'Image',
  'image-prompt-analysis-reference': 'Image',
  'image-portrait-generation': 'Image',
  'background-image-prompt-analysis': 'Image',

  // Translation
  'translate-narration': 'Translation',
  'translate-input': 'Translation',
  'translate-ui': 'Translation',
  'translate-suggestions': 'Translation',
  'translate-action-choices': 'Translation',
  'translate-wizard-content': 'Translation',

  // Wizard
  'setting-expansion': 'Wizard',
  'setting-refinement': 'Wizard',
  'protagonist-generation': 'Wizard',
  'character-elaboration': 'Wizard',
  'character-refinement': 'Wizard',
  'supporting-characters': 'Wizard',
  'opening-generation-adventure': 'Wizard',
  'opening-generation-creative': 'Wizard',
  'opening-refinement-adventure': 'Wizard',
  'opening-refinement-creative': 'Wizard',
  'character-card-import': 'Wizard',
  'vault-character-import': 'Wizard',
}

/** Group display order */
const GROUP_ORDER = [
  'Story Generation',
  'Analysis',
  'Memory',
  'Suggestions & Actions',
  'Image',
  'Translation',
  'Wizard',
]

/**
 * Build template groups from PROMPT_TEMPLATES.
 * Returns ordered array of groups, each containing their templates.
 */
export function getTemplateGroups(): TemplateGroup[] {
  const groupMap = new Map<string, PromptTemplate[]>()

  for (const template of PROMPT_TEMPLATES) {
    const groupName = TEMPLATE_GROUP_MAP[template.id] ?? 'Other'
    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, [])
    }
    groupMap.get(groupName)!.push(template)
  }

  // Include 'Other' group at the end if it exists
  const orderedGroups = GROUP_ORDER.filter((name) => groupMap.has(name))
  if (groupMap.has('Other')) {
    orderedGroups.push('Other')
  }

  return orderedGroups.map((name) => ({
    name,
    templates: groupMap.get(name)!,
  }))
}

/** Get the group name for a template ID */
export function getTemplateGroup(templateId: string): string {
  return TEMPLATE_GROUP_MAP[templateId] ?? 'Other'
}
