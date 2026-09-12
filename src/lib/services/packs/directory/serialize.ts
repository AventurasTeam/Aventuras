/**
 * Reading and writing the files of an exported pack directory.
 *
 * Everything here is deterministic: the same pack serialises to the same bytes, because a
 * tree that differs between two exports of identical content cannot be merged.
 */

import * as z from 'zod'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { CustomVariableSchema } from '../validation'

/** Version of the directory layout, not of any pack. */
export const DIRECTORY_FORMAT_VERSION = 1

/** Whether a tree came from a pack's stored rows or from the text the app ships. */
export type TreeSource = 'pack' | 'shipped-baseline'

const PackFileSchema = z.object({
  formatVersion: z.number().int().positive(),
  appVersion: z.string(),
  source: z.enum(['pack', 'shipped-baseline']),
  name: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  variables: z.array(CustomVariableSchema),
})

export type PackFile = z.infer<typeof PackFileSchema>

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Ordering that survives a rename: author intent first, then name for anything it leaves tied. */
function bySortOrderThenName(
  a: PackFile['variables'][number],
  b: PackFile['variables'][number],
): number {
  const order = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  return order !== 0 ? order : a.variableName.localeCompare(b.variableName)
}

/**
 * Write `pack.yaml`.
 *
 * Keys are emitted in a fixed order and no timestamp is written: a value that changes
 * between two exports of the same pack conflicts on every merge and says nothing the commit
 * does not already.
 */
export function serializePackFile(file: PackFile): string {
  const ordered: Record<string, unknown> = {
    formatVersion: file.formatVersion,
    appVersion: file.appVersion,
    source: file.source,
    name: file.name,
  }
  if (file.description !== undefined) ordered.description = file.description
  if (file.author !== undefined) ordered.author = file.author

  ordered.variables = [...file.variables].sort(bySortOrderThenName).map((variable) => {
    const entry: Record<string, unknown> = {
      variableName: variable.variableName,
      displayName: variable.displayName,
      variableType: variable.variableType,
      isRequired: variable.isRequired,
      sortOrder: variable.sortOrder ?? 0,
    }
    if (variable.description !== undefined) entry.description = variable.description
    if (variable.defaultValue !== undefined) entry.defaultValue = variable.defaultValue
    if (variable.enumOptions !== undefined) {
      entry.enumOptions = variable.enumOptions.map((option) => ({
        label: option.label,
        value: option.value,
      }))
    }
    return entry
  })

  return stringifyYaml(ordered, { lineWidth: 0 })
}

/** Read `pack.yaml`, refusing a format this version cannot read. */
export function parsePackFile(text: string): ParseResult<PackFile> {
  let data: unknown
  try {
    data = parseYaml(text)
  } catch (e) {
    return { ok: false, error: `pack.yaml is not valid YAML: ${(e as Error).message}` }
  }

  const result = PackFileSchema.safeParse(data)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return { ok: false, error: `pack.yaml is missing or malformed: ${issues}` }
  }

  if (result.data.formatVersion > DIRECTORY_FORMAT_VERSION) {
    return {
      ok: false,
      error: `pack.yaml declares format version ${result.data.formatVersion}, but this version of the app reads up to ${DIRECTORY_FORMAT_VERSION}. Update the app to import this directory.`,
    }
  }

  return { ok: true, value: result.data }
}

function toLineFeeds(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

/** Write a template's text: line feeds, ending in exactly one newline. */
export function serializeTemplate(content: string): string {
  return `${toLineFeeds(content).replace(/\n+$/, '')}\n`
}

/**
 * Read a template's text back.
 *
 * Carriage returns an external editor introduced are dropped, so a round trip through one
 * leaves the stored hash — which normalises the same way — untouched.
 */
export function parseTemplateFile(text: string): string {
  return toLineFeeds(text).replace(/\n+$/, '')
}
