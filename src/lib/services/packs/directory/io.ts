/**
 * Reading and writing an exported tree on disk.
 *
 * The only part of the directory format that touches Tauri. `recursive: true` on the folder
 * picker is what puts the chosen directory in the fs scope for the session; without it every
 * write below is refused.
 */

import { open } from '@tauri-apps/plugin-dialog'
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { classifyPath } from './layout'
import { emptiedFolderCandidates, type FolderChanges, type Tree } from './tree'

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

interface Listing {
  files: string[]
  directories: string[]
}

/** Every file and folder below `root`, as paths relative to it. */
async function listEntries(
  root: string,
  relativeDir = '',
  listing: Listing = { files: [], directories: [] },
): Promise<Listing> {
  const entries = await readDir(relativeDir ? joinPath(root, relativeDir) : root)

  for (const entry of entries) {
    const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    if (entry.isDirectory) {
      listing.directories.push(relative)
      if (!isSkippedDirectory(entry.name)) await listEntries(root, relative, listing)
    } else if (entry.isFile) listing.files.push(relative)
  }

  return listing
}

export interface ReadTree {
  /** Every file found, whether or not the import reads it. Needed to plan a prune. */
  allPaths: string[]
  /** Every folder found, so a rename does not pick a name a folder already has. */
  directoryPaths: string[]
  /** Only the files an import reads, by relative path. */
  contents: Map<string, string>
}

/** Read a tree, loading only the files an import actually reads. */
export async function readTree(root: string): Promise<ReadTree> {
  const { files: allPaths, directories: directoryPaths } = await listEntries(root)
  const contents = new Map<string, string>()

  for (const path of allPaths) {
    if (classifyPath(path) === 'ignored') continue
    contents.set(path, await readTextFile(joinPath(root, path)))
  }

  return { allPaths, directoryPaths, contents }
}

/** Apply `renames`, write every file of `tree`, creating folders as needed, then prune. */
export async function writeTree(
  root: string,
  tree: Tree,
  { prunePaths, renames }: FolderChanges,
): Promise<void> {
  // First: a renamed file can share a name with one the tree is about to write. The plan waited
  // on the confirmation, so a target that appeared since stops the export rather than being lost.
  for (const { to } of renames) {
    if (await exists(joinPath(root, to))) {
      throw new Error(`${to} appeared in the folder since the export was planned. Export again.`)
    }
  }
  for (const { from, to } of renames) {
    await rename(joinPath(root, from), joinPath(root, to))
  }

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

  // Only folders the prune emptied: one the user left empty themselves is not touched.
  for (const folder of emptiedFolderCandidates(prunePaths)) {
    if ((await readDir(joinPath(root, folder))).length === 0) await remove(joinPath(root, folder))
  }
}
