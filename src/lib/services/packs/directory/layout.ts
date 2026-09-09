/**
 * Where each part of a pack lives inside an exported directory, and which files an import
 * reads back.
 *
 * Export and import both resolve paths through here. A disagreement between them is silent
 * data loss, so neither derives a path of its own.
 */

import { describeTemplate } from '$lib/components/vault/prompts/templateGroups'

/** Pack metadata and custom variables. */
export const PACK_FILE = 'pack.yaml'

/** Generated description of the tree, overwritten on every export. */
export const ABOUT_FILE = 'ABOUT.md'

/** Generated line-ending configuration, overwritten on every export. */
export const GITATTRIBUTES_FILE = '.gitattributes'

/** Generated reference material; never read back. */
export const REFERENCE_DIR = '_reference'

/** Holds templates whose id the app no longer ships. */
export const UNGROUPED_DIR = 'Other'

/** Suffix marking a prompt's user-message half, as stored. */
export const USER_HALF_SUFFIX = '-user'

/** Files the export writes and overwrites; everything else at the root belongs to the user. */
export const RESERVED_ROOT_FILES = [PACK_FILE, ABOUT_FILE, GITATTRIBUTES_FILE]

/** How a path in an exported tree is treated on import. */
export type PathRole = 'template' | 'pack-file' | 'ignored'

const MARKDOWN_EXTENSION = '.md'

function segmentsOf(path: string): string[] {
  return path.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

/** The folder a template's file sits in: its display group, or `Other` for an id the app no longer ships. */
export function groupFolderFor(templateId: string): string {
  return describeTemplate(templateId)?.group ?? UNGROUPED_DIR
}

/** Where a stored template's file belongs, relative to the tree's root. */
export function templatePath(templateId: string): string {
  return `${groupFolderFor(templateId)}/${templateId}${MARKDOWN_EXTENSION}`
}

/**
 * How an import treats a path.
 *
 * A template is any Markdown file below the root whose path contains no `_`-prefixed segment.
 * The folder is presentation, so reorganising one does not change what a file is.
 */
export function classifyPath(path: string): PathRole {
  const segments = segmentsOf(path)
  if (segments.length === 0) return 'ignored'
  if (segments.length === 1) return segments[0] === PACK_FILE ? 'pack-file' : 'ignored'
  // Folders only. A template whose own id starts with `_` is still a template.
  if (segments.slice(0, -1).some((segment) => segment.startsWith('_'))) return 'ignored'
  return segments[segments.length - 1].endsWith(MARKDOWN_EXTENSION) ? 'template' : 'ignored'
}

/**
 * The stored id a template file carries.
 *
 * The filename alone, so a file moved between folders is still the same template and an
 * upstream regrouping is a rename rather than a delete and an add.
 */
export function templateIdFromPath(path: string): string | null {
  if (classifyPath(path) !== 'template') return null
  const segments = segmentsOf(path)
  return segments[segments.length - 1].slice(0, -MARKDOWN_EXTENSION.length)
}

/** Characters Win32 forbids outright in a filename. */
const FILESYSTEM_UNSAFE = /[<>:"|?*]/

/** MS-DOS device names, still refused by Win32 with or without an extension. */
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 32) return true
  }
  return false
}

/**
 * Whether this id survives being written as a filename and read back.
 *
 * `PackTemplateSchema` accepts any non-empty string, so a hand-written `.prompt.json` can
 * carry an id that is not a usable filename: a path separator, which would gain a folder and
 * come back as only its last segment, or a character Windows forbids, which fails at the
 * write. Rather than encode ids and make every filename harder to read, an export refuses
 * the ones that would not survive.
 */
export function isWritableTemplateId(templateId: string): boolean {
  if (templateId.length === 0) return false
  if (FILESYSTEM_UNSAFE.test(templateId)) return false
  if (hasControlCharacter(templateId)) return false
  if (RESERVED_DEVICE_NAMES.test(templateId)) return false
  // Windows silently strips a trailing dot or space, so the file would not be found again
  // under its own id.
  if (/[. ]$/.test(templateId)) return false
  // Catches the path separators, which would gain a folder and come back truncated.
  return templateIdFromPath(templatePath(templateId)) === templateId
}

/** Two files resolving to one stored id. */
export interface DuplicateTemplate {
  templateId: string
  paths: string[]
}

export interface CollectedTemplates {
  /** Stored id to the path it was found at. Empty when any duplicate was found. */
  templates: Map<string, string>
  duplicates: DuplicateTemplate[]
}

/**
 * Resolve a tree's paths to stored ids.
 *
 * The folder no longer disambiguates two files sharing a name, so a collision is refused
 * rather than resolved: returning no templates keeps a partial import impossible.
 */
export function collectTemplateFiles(paths: string[]): CollectedTemplates {
  // Keyed without case, so two files that are one file on Windows and macOS are refused here
  // rather than importing as two rows on Linux -- rows `buildTree` would then refuse to export,
  // leaving a pack whose directory export can never succeed and no way to rename a stored id.
  const byId = new Map<string, { templateId: string; paths: string[] }>()

  for (const path of paths) {
    const templateId = templateIdFromPath(path)
    if (templateId === null) continue
    const key = templateId.toLowerCase()
    const existing = byId.get(key)
    if (existing) existing.paths.push(path)
    else byId.set(key, { templateId, paths: [path] })
  }

  const duplicates: DuplicateTemplate[] = []
  const templates = new Map<string, string>()

  for (const { templateId, paths: found } of byId.values()) {
    if (found.length > 1) duplicates.push({ templateId, paths: [...found].sort() })
    else templates.set(templateId, found[0])
  }

  duplicates.sort((a, b) => a.templateId.localeCompare(b.templateId))
  if (duplicates.length > 0) return { templates: new Map(), duplicates }
  return { templates, duplicates }
}
