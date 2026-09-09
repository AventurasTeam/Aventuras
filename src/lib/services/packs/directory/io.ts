/**
 * Reading and writing an exported tree on disk.
 *
 * The only part of the directory format that touches Tauri. `recursive: true` on the folder
 * picker is what puts the chosen directory in the fs scope for the session; without it every
 * write below is refused.
 */

import { open } from '@tauri-apps/plugin-dialog'
import { mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { classifyPath } from './layout'
import type { Tree } from './tree'

/** Ask for a directory, adding it to the fs scope. `null` if the user cancelled. */
export async function pickDirectory(title: string): Promise<string | null> {
  const chosen = await open({ directory: true, multiple: false, recursive: true, title })
  return typeof chosen === 'string' ? chosen : null
}

function joinPath(root: string, relative: string): string {
  return `${root}/${relative}`
}

/**
 * Directories never worth walking into.
 *
 * A tree lives in a git repository -- that is the point of the format -- so `.git` alone is
 * thousands of loose-object files reached one `readDir` round-trip at a time. Nothing under a
 * dot-directory can be a template or a file this export owns, so descending is pure cost.
 */
function isSkippedDirectory(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

/** Every file below `root`, as paths relative to it. */
export async function listFiles(root: string, relativeDir = ''): Promise<string[]> {
  const entries = await readDir(relativeDir ? joinPath(root, relativeDir) : root)
  const files: string[] = []

  for (const entry of entries) {
    const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    if (entry.isDirectory) {
      if (isSkippedDirectory(entry.name)) continue
      files.push(...(await listFiles(root, relative)))
    } else if (entry.isFile) files.push(relative)
  }

  return files
}

export interface ReadTree {
  /** Every file found, whether or not the import reads it. Needed to plan a prune. */
  allPaths: string[]
  /** Only the files an import reads, by relative path. */
  contents: Map<string, string>
}

/** Read a tree, loading only the files an import actually reads. */
export async function readTree(root: string): Promise<ReadTree> {
  const allPaths = await listFiles(root)
  const contents = new Map<string, string>()

  for (const path of allPaths) {
    if (classifyPath(path) === 'ignored') continue
    contents.set(path, await readTextFile(joinPath(root, path)))
  }

  return { allPaths, contents }
}

/** Write every file of `tree`, creating folders as needed, then remove `prunePaths`. */
export async function writeTree(root: string, tree: Tree, prunePaths: string[]): Promise<void> {
  const directories = new Set<string>()
  for (const path of tree.keys()) {
    const lastSlash = path.lastIndexOf('/')
    if (lastSlash > 0) directories.add(path.slice(0, lastSlash))
  }

  for (const directory of [...directories].sort()) {
    await mkdir(joinPath(root, directory), { recursive: true })
  }

  for (const [path, content] of tree) {
    await writeTextFile(joinPath(root, path), content)
  }

  for (const path of prunePaths) {
    await remove(joinPath(root, path))
  }
}
