import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { resolveSaveTarget } from './exportTarget'
import { errMessage } from '$lib/utils/error'
import { openFilters } from '$lib/utils/dialogFilters'
import { importFromJson, importFromFile, EXPORT_FORMAT_VERSION } from './import'
import type { AventuraExport, ImportResult, RunImportOptions } from './import'
import type { PackBindingExport } from './import'

// Re-exported for the modules that imported these from here before the import logic moved.
export type { AventuraExport } from './import'
export { EXPORT_FORMAT_VERSION } from './import'
import type {
  Story,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  Entry,
  Checkpoint,
  Branch,
  EmbeddedImageMeta,
} from '$lib/types'

class ExportService {
  // Export to Aventura format (.avt - JSON)
  async exportToAventura(
    story: Story,
    entries: StoryEntry[],
    characters: Character[],
    locations: Location[],
    items: Item[],
    storyBeats: StoryBeat[],
    lorebookEntries: Entry[] = [],
    embeddedImages: EmbeddedImageMeta[] = [],
    checkpoints: Checkpoint[] = [],
    branches: Branch[] = [],
    chapters: Chapter[] = [],
    currentBgImage: string | null = null,
    // Identity and variable *shape* only — never the pack's templates, which stay owned by the
    // pack as installed on whichever device generates. Null for a story with no pack row.
    packBinding: PackBindingExport | null = null,
  ): Promise<boolean> {
    // embeddedImages is metadata only (no base64). The native exporter fills in each image's
    // imageData from SQLite, so the heavy bytes never sit in the JS heap (their only home would
    // otherwise be a giant JSON.stringify string → Android OOM).
    const exportData: Omit<AventuraExport, 'embeddedImages'> & {
      embeddedImages: EmbeddedImageMeta[]
    } = {
      version: EXPORT_FORMAT_VERSION,
      exportedAt: Date.now(),
      story,
      entries,
      characters,
      locations,
      items,
      storyBeats,
      lorebookEntries,
      styleReviewState: story.styleReviewState,
      embeddedImages,
      checkpoints,
      branches,
      chapters,
      currentBgImage,
      // Omitted rather than written as null, so a story with no pack produces a file that is
      // byte-for-byte the legacy shape and takes the legacy import path.
      ...(packBinding ? { packBinding } : {}),
    }

    const target = await resolveSaveTarget(`${this.sanitizeFilename(story.title)}.avt`, [
      { name: 'Aventura Story', extensions: ['avt'] },
      { name: 'JSON', extensions: ['json'] },
    ])
    if (!target) return false

    // Build the .avt natively: Rust injects each image's base64 from SQLite and writes the JSON
    // straight to the chosen destination (a SAF content:// URI on Android) — no image bytes cross
    // the JS/IPC bridge.
    await invoke<string>('export_story_avt', {
      storyJson: JSON.stringify(exportData),
      destPath: target.destPath,
    })
    return true
  }

  // Export to Markdown
  async exportToMarkdown(
    story: Story,
    entries: StoryEntry[],
    characters: Character[],
    locations: Location[],
    includeWorldState: boolean = false,
  ): Promise<boolean> {
    let markdown = `# ${story.title}\n\n`

    if (story.description) {
      markdown += `*${story.description}*\n\n`
    }

    if (story.genre) {
      markdown += `**Genre:** ${story.genre}\n\n`
    }

    markdown += `---\n\n`

    // Add story entries (use translated content when available)
    for (const entry of entries) {
      if (entry.type === 'user_action') {
        // For user actions, show original input if translation was used, otherwise show content
        const displayContent = entry.originalInput ?? entry.content
        markdown += `> **You:** ${displayContent}\n\n`
      } else if (entry.type === 'narration') {
        // For narration, use translated content if available
        const displayContent = entry.translatedContent ?? entry.content
        markdown += `${displayContent}\n\n`
      } else if (entry.type === 'system') {
        markdown += `*[System: ${entry.content}]*\n\n`
      }
    }

    // Optionally include world state
    if (includeWorldState) {
      markdown += `---\n\n## World State\n\n`

      if (characters.length > 0) {
        markdown += `### Characters\n\n`
        for (const char of characters) {
          markdown += `- **${char.name}**`
          if (char.relationship) markdown += ` (${char.relationship})`
          if (char.description) markdown += `: ${char.description}`
          markdown += `\n`
        }
        markdown += `\n`
      }

      if (locations.length > 0) {
        markdown += `### Locations\n\n`
        for (const loc of locations) {
          markdown += `- **${loc.name}**`
          if (loc.current) markdown += ` [Current]`
          if (loc.visited) markdown += ` [Visited]`
          if (loc.description) markdown += `: ${loc.description}`
          markdown += `\n`
        }
        markdown += `\n`
      }
    }

    // Add export metadata
    markdown += `---\n\n`
    markdown += `*Exported from Aventura on ${new Date().toLocaleDateString()}*\n`

    const target = await resolveSaveTarget(`${this.sanitizeFilename(story.title)}.md`, [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] },
    ])
    if (!target) return false

    await writeTextFile(target.destPath, markdown)
    return true
  }

  // Export to plain text
  async exportToText(story: Story, entries: StoryEntry[]): Promise<boolean> {
    let text = `${story.title}\n${'='.repeat(story.title.length)}\n\n`

    if (story.description) {
      text += `${story.description}\n\n`
    }

    text += `---\n\n`

    // Use translated content when available
    for (const entry of entries) {
      if (entry.type === 'user_action') {
        // For user actions, show original input if translation was used
        const displayContent = entry.originalInput ?? entry.content
        text += `> ${displayContent}\n\n`
      } else if (entry.type === 'narration') {
        // For narration, use translated content if available
        const displayContent = entry.translatedContent ?? entry.content
        text += `${displayContent}\n\n`
      }
    }

    const target = await resolveSaveTarget(`${this.sanitizeFilename(story.title)}.txt`, [
      { name: 'Text', extensions: ['txt'] },
    ])
    if (!target) return false

    await writeTextFile(target.destPath, text)
    return true
  }

  // Import a story through the native file dialog.
  // `resolvePackBinding` is how the caller puts a pack mapping step in front of the import; when
  // omitted, the headless auto-matcher decides.
  async importFromAventura(
    options: Pick<RunImportOptions, 'resolvePackBinding'> = {},
  ): Promise<ImportResult> {
    // openFilters drops these on Android, where a .avt is not selectable with them. See there.
    const filePath = await open({
      filters: openFilters([
        { name: 'Aventura Story', extensions: ['avt'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ]),
    })

    if (!filePath || typeof filePath !== 'string') {
      return { success: false }
    }

    try {
      // Read natively: the file's image payloads never enter the JS heap, so a large story
      // imports without hitting Android's WebView heap cap. `filePath` may be a SAF
      // content:// URI there, which the native side opens via the fs plugin.
      return await importFromFile(filePath, options)
    } catch (error) {
      console.error('Import failed:', error)
      return {
        success: false,
        error: errMessage(error),
      }
    }
  }

  // Import from a JSON string (HTML file input, and sync which receives a story over the network).
  // Set skipImportedSuffix to true for sync operations to keep the original title.
  //
  // Sync resolves the pack itself, before it deletes the story it is replacing, and passes the
  // answer here through `options.resolvePackBinding` — so by the time this runs the decision is
  // already made and simply replayed.
  async importFromContent(
    content: string,
    skipImportedSuffix: boolean = false,
    options: Pick<RunImportOptions, 'resolvePackBinding'> = {},
  ): Promise<ImportResult> {
    return importFromJson(content, { ...options, skipImportedSuffix })
  }

  /** What a payload says about its pack, so a caller can settle it before importing. */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 100)
  }
}

export const exportService = new ExportService()

// Re-export coordination service
export {
  gatherPackBinding,
  gatherStoryData,
  type StoryExportData,
} from './export/ExportCoordinationService'
