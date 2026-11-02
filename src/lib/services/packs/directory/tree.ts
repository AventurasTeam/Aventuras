/**
 * The contents of an exported tree, as a map of relative path to text.
 *
 * Building the tree is kept apart from writing it: the determinism the format depends on is
 * a property of this map, and a map is something a test can compare byte for byte.
 */

import { PROMPT_TEMPLATES } from '#lib/services/prompts/templates/index.ts'
import type { PackExport } from '../validation'
import {
  ABOUT_FILE,
  GITATTRIBUTES_FILE,
  PACK_FILE,
  README_FILE,
  REFERENCE_DIR,
  USER_HALF_SUFFIX,
  USER_README_STEM,
  VERSION_FILE,
  classifyPath,
  isWritableTemplateId,
  templatePath,
} from './layout'
import { gitattributesDoc, readmeDoc, variablesDoc, versionDoc } from './reference'
import {
  DIRECTORY_FORMAT_VERSION,
  declaredFormatVersion,
  parsePackFile,
  serializePackFile,
  serializeTemplate,
  type TreeSource,
} from './serialize'

export interface StoredTemplate {
  templateId: string
  content: string
}

export interface TreeInput {
  source: TreeSource
  appVersion: string
  name: string
  description?: string
  author?: string
  templates: StoredTemplate[]
  variables: PackExport['variables']
}

/** A tree, as relative path to file contents. */
export type Tree = Map<string, string>

/** Every row a full pack holds: each shipped template's system half, and its user half where one ships. */
export function shippedTemplateRows(): StoredTemplate[] {
  const rows: StoredTemplate[] = []
  for (const template of PROMPT_TEMPLATES) {
    rows.push({ templateId: template.id, content: template.content })
    if (template.userContent !== undefined) {
      rows.push({
        templateId: `${template.id}${USER_HALF_SUFFIX}`,
        content: template.userContent,
      })
    }
  }
  return rows
}

export function buildTree(input: TreeInput): Tree {
  const ids = input.templates.map((t) => t.templateId)

  const unwritable = ids.filter((id) => !isWritableTemplateId(id)).sort()
  if (unwritable.length > 0) {
    throw new Error(
      `These template ids cannot be written as filenames, so exporting them would change what they are: ${unwritable.join(', ')}`,
    )
  }

  // Two ids differing only in case are one file on Windows and macOS, so one would silently
  // overwrite the other and the export would be missing a template.
  const byLowercase = new Map<string, string[]>()
  for (const id of ids) {
    const key = id.toLowerCase()
    byLowercase.set(key, [...(byLowercase.get(key) ?? []), id])
  }
  const colliding = [...byLowercase.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort().join(' and '))
    .sort()
  if (colliding.length > 0) {
    throw new Error(
      `These template ids differ only in capitalisation, so they cannot both be written as files: ${colliding.join('; ')}`,
    )
  }

  const tree: Tree = new Map()

  for (const template of input.templates) {
    tree.set(templatePath(template.templateId), serializeTemplate(template.content))
  }

  tree.set(
    PACK_FILE,
    serializePackFile({
      formatVersion: DIRECTORY_FORMAT_VERSION,
      source: input.source,
      name: input.name,
      description: input.description,
      author: input.author,
      variables: input.variables,
    }),
  )
  tree.set(README_FILE, readmeDoc())
  tree.set(GITATTRIBUTES_FILE, gitattributesDoc())
  tree.set(`${REFERENCE_DIR}/system-variables.md`, variablesDoc('system'))
  tree.set(`${REFERENCE_DIR}/runtime-variables.md`, variablesDoc('runtime'))
  tree.set(`${REFERENCE_DIR}/${VERSION_FILE}`, versionDoc(input.appVersion))

  return tree
}

/** The tree for the prompt text this version of the app ships, which no edit can reach. */
export function buildShippedBaselineTree(appVersion: string): Tree {
  return buildTree({
    source: 'shipped-baseline',
    appVersion,
    name: 'Aventuras shipped prompts',
    description: 'The prompt text this version of Aventuras ships. Exported as a merge base.',
    templates: shippedTemplateRows(),
    variables: [],
  })
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Which files of an existing tree this export leaves behind.
 *
 * Confined to template files and generated reference material: a tree lives in a repository
 * next to a README, notes and `.git`, and removing a file the export does not own would make
 * that unsafe. A stale template file has to go, though — it would otherwise import as a
 * template the pack no longer has.
 */
export function planPrune(existingPaths: string[], tree: Tree): string[] {
  // Compared without case, because Windows and macOS resolve two spellings of a path to one
  // file: pruning a path this export just wrote under different casing deletes the file it
  // had only moments before written. Leaving a genuinely distinct file behind on a
  // case-sensitive system is the safe failure -- it surfaces as a refused import naming both
  // paths, not as a template silently missing from a successful export.
  const written = new Set([...tree.keys()].map((path) => path.toLowerCase()))

  return existingPaths
    .map(normalizePath)
    .filter((path) => !written.has(path.toLowerCase()))
    .filter(
      (path) =>
        classifyPath(path) === 'template' ||
        path.toLowerCase().startsWith(`${REFERENCE_DIR.toLowerCase()}/`),
    )
    .sort()
}

/** Who wrote the chosen folder, as far as its `pack.yaml` says. */
export type FolderOrigin = 'current' | 'earlier' | 'newer' | 'foreign'

export function folderOrigin(packFileText: string | undefined): FolderOrigin {
  if (packFileText === undefined) return 'foreign'
  if ((declaredFormatVersion(packFileText) ?? 0) > DIRECTORY_FORMAT_VERSION) return 'newer'
  const parsed = parsePackFile(packFileText)
  if (!parsed.ok) return 'foreign'
  return parsed.value.formatVersion < DIRECTORY_FORMAT_VERSION ? 'earlier' : 'current'
}

export interface FileRename {
  from: string
  to: string
}

/** What an export does to a folder's existing files besides overwriting the ones it writes. */
export interface FolderChanges {
  prunePaths: string[]
  /** Applied before the tree is written, so the export's own file can take the old name. */
  renames: FileRename[]
}

/** Every root path spelling `name`, compared without case: one file on Windows and macOS, several on Linux. */
function findRootFiles(paths: string[], name: string): string[] {
  return paths.filter((path) => path.toLowerCase() === name.toLowerCase())
}

/** Each `README.md` the export did not write moves to the next free `README_user[_N].md`. */
function planReadmeRenames(paths: string[]): FileRename[] {
  const taken = new Set(paths.map((path) => path.toLowerCase()))
  return findRootFiles(paths, README_FILE)
    .toSorted()
    .map((from) => {
      let to = `${USER_README_STEM}.md`
      for (let n = 2; taken.has(to.toLowerCase()); n++) to = `${USER_README_STEM}_${n}.md`
      taken.add(to.toLowerCase())
      return { from, to }
    })
}

/** Plan the changes to a folder's existing files; the rules are in docs/architecture/prompts.md. */
export function planFolderChanges(
  existingPaths: string[],
  tree: Tree,
  origin: Exclude<FolderOrigin, 'newer'>,
): FolderChanges {
  const paths = existingPaths.map(normalizePath)
  const prunePaths = origin === 'foreign' ? [] : planPrune(paths, tree)
  if (origin === 'earlier') prunePaths.push(...findRootFiles(paths, ABOUT_FILE))

  return {
    prunePaths: prunePaths.toSorted(),
    renames: origin === 'current' ? [] : planReadmeRenames(paths),
  }
}

/**
 * Folders that may be left empty once `prunePaths` are gone, deepest first, so a parent is
 * checked after its children.
 */
export function emptiedFolderCandidates(prunePaths: string[]): string[] {
  const folders = new Set<string>()
  for (const path of prunePaths) {
    const segments = normalizePath(path).split('/').slice(0, -1)
    for (let depth = 1; depth <= segments.length; depth++) {
      folders.add(segments.slice(0, depth).join('/'))
    }
  }
  return [...folders].toSorted(
    (a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b),
  )
}
