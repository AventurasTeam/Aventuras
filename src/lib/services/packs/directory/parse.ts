/**
 * Turning a read tree into the pack shape the existing import paths already take.
 *
 * A directory is a second source for `applyImport` and `updatePackFromFile`, not a second
 * import: everything past this point is the code that already handles `.prompt.json`.
 */

import { templateEngine } from '$lib/services/templates/engine'
import { validatePackImport, type PackExport } from '../validation'
import { PACK_FILE, collectTemplateFiles } from './layout'
import { parsePackFile, parseTemplateFile, type TreeSource } from './serialize'

export interface TemplateFileError {
  templateId: string
  path: string
  error: string
}

export interface DirectoryValidationResult {
  valid: boolean
  structuralErrors: string[]
  templateErrors: TemplateFileError[]
  pack?: PackExport
  source?: TreeSource
}

/**
 * Validate a tree in full before any of it is written.
 *
 * Every failure is collected rather than thrown at the first one: a user fixing a merge wants
 * the whole list, and a partially applied tree is worse than a refused one.
 */
export function validateTree(contents: Map<string, string>): DirectoryValidationResult {
  const { templates: files, duplicates } = collectTemplateFiles([...contents.keys()])

  if (duplicates.length > 0) {
    return {
      valid: false,
      structuralErrors: duplicates.map(
        (d) => `Two files are both the template "${d.templateId}": ${d.paths.join(' and ')}`,
      ),
      templateErrors: [],
    }
  }

  const packFileText = contents.get(PACK_FILE)
  if (packFileText === undefined) {
    return {
      valid: false,
      structuralErrors: [`This folder has no ${PACK_FILE}, so it is not an exported prompt pack.`],
      templateErrors: [],
    }
  }

  const packFile = parsePackFile(packFileText)
  if (!packFile.ok) {
    return { valid: false, structuralErrors: [packFile.error], templateErrors: [] }
  }

  const templateIds = [...files.keys()].sort()
  const candidate = {
    version: 1,
    name: packFile.value.name,
    description: packFile.value.description,
    author: packFile.value.author,
    templates: templateIds.map((templateId) => ({
      templateId,
      content: parseTemplateFile(contents.get(files.get(templateId)!)!),
    })),
    variables: packFile.value.variables,
  }

  const structural = validatePackImport(candidate)
  if (!structural.valid) {
    return { valid: false, structuralErrors: structural.errors ?? [], templateErrors: [] }
  }

  const templateErrors: TemplateFileError[] = []
  for (const template of structural.pack!.templates) {
    const parsed = templateEngine.parseTemplate(template.content)
    if (!parsed.success) {
      templateErrors.push({
        templateId: template.templateId,
        path: files.get(template.templateId)!,
        error: parsed.error ?? 'Unknown parse error',
      })
    }
  }

  if (templateErrors.length > 0) {
    return { valid: false, structuralErrors: [], templateErrors }
  }

  return {
    valid: true,
    structuralErrors: [],
    templateErrors: [],
    pack: structural.pack,
    source: packFile.value.source,
  }
}
