import type { PromptTemplate, PromptCategory } from '../types'

const USER_DELIMITER = '---USER---'
const REQUIRED_FIELDS = ['id', 'name', 'category', 'description'] as const

/**
 * Parse a .liquid file with YAML frontmatter into a PromptTemplate.
 */
export function parseLiquidTemplate(raw: string, filename: string): PromptTemplate {
  const firstFence = raw.indexOf('---')
  if (firstFence !== 0) {
    throw new Error(`${filename}: missing frontmatter (must start with ---)`)
  }
  const secondFence = raw.indexOf('---', 3)
  if (secondFence === -1) {
    throw new Error(`${filename}: malformed frontmatter (no closing ---)`)
  }

  const frontmatterBlock = raw.slice(3, secondFence).trim()
  const meta: Record<string, string> = {}
  for (const line of frontmatterBlock.split('\n')) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue
    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim()
    meta[key] = value
  }

  for (const field of REQUIRED_FIELDS) {
    if (!meta[field]) {
      throw new Error(`${filename}: missing required frontmatter field '${field}'`)
    }
  }

  const body = raw.slice(secondFence + 3)
  const delimiterIndex = body.indexOf(`\n${USER_DELIMITER}`)

  let content: string
  let userContent: string | undefined

  if (delimiterIndex === -1) {
    content = body.trim()
  } else {
    content = body.slice(0, delimiterIndex).trim()
    userContent = body.slice(delimiterIndex + USER_DELIMITER.length + 1).trim() || undefined
  }

  return {
    id: meta.id,
    name: meta.name,
    category: meta.category as PromptCategory,
    description: meta.description,
    content,
    userContent,
  }
}

const liquidFiles: Record<string, string> = import.meta.glob('./**/*.liquid', {
  query: '?raw',
  eager: true,
  import: 'default',
})

export function loadAllTemplates(): PromptTemplate[] {
  const templates: PromptTemplate[] = []
  const seenIds = new Map<string, string>()

  for (const [path, raw] of Object.entries(liquidFiles)) {
    const filename = path.split('/').pop() ?? path
    const template = parseLiquidTemplate(raw, filename)

    if (seenIds.has(template.id)) {
      throw new Error(
        `Duplicate template ID '${template.id}' in ${filename} ` +
          `(already defined in ${seenIds.get(template.id)})`,
      )
    }
    seenIds.set(template.id, filename)
    templates.push(template)
  }

  return templates
}

export const LIQUID_TEMPLATES: PromptTemplate[] = loadAllTemplates()
