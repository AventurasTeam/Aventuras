import { database } from '$lib/services/database'
import { emitChapterCreated } from '$lib/services/events'
import type { Chapter, StoryEntry } from '$lib/types'
import type { StoryStore } from './types'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Chapter]', ...args)
  }
}

export class StoryChapterStore {
  constructor(private ctx: StoryStore) {}

  chapters = $state<Chapter[]>([])

  private _cachedLastChapterEndIndex: number = 0
  private _lastChapterEndIndexDirty: boolean = true
  private _lastChaptersLength: number = 0
  private _lastEntriesLength: number = 0

  // Add a chapter
  async addChapter(chapter: Chapter): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    await database.addChapter(chapter)
    this.chapters = [...this.chapters, chapter]

    // Invalidate chapter cache
    this.invalidateChapterCache()

    log('Chapter added:', chapter.number, chapter.title)

    // Emit event
    emitChapterCreated(chapter.id, chapter.number, chapter.title)
  }

  // Get the next chapter number from the database (handles deletions correctly)
  async getNextChapterNumber(): Promise<number> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    // Use branch-filtered chapters to determine next chapter number
    // storyContext.chapters is already filtered to current branch view (inherited + branch-specific)
    if (this.chapters.length === 0) {
      return 1
    }

    // Find the maximum chapter number in the current branch view
    const maxNumber = Math.max(...this.chapters.map((ch) => ch.number))
    return maxNumber + 1
  }

  // Update a chapter's summary
  async updateChapterSummary(chapterId: string, summary: string): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    await database.updateChapter(chapterId, { summary })
    this.chapters = this.chapters.map((ch) => (ch.id === chapterId ? { ...ch, summary } : ch))
    log('Chapter summary updated:', chapterId)
  }

  // Update a chapter with multiple fields
  async updateChapter(chapterId: string, updates: Partial<Chapter>): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    await database.updateChapter(chapterId, updates)
    this.chapters = this.chapters.map((ch) => (ch.id === chapterId ? { ...ch, ...updates } : ch))
    log('Chapter updated:', chapterId, updates)
  }

  // Get entries for a specific chapter
  getChapterEntries(chapter: Chapter): StoryEntry[] {
    const entries = this.ctx.entry.entries
    const startIdx = entries.findIndex((e) => e.id === chapter.startEntryId)
    const endIdx = entries.findIndex((e) => e.id === chapter.endEntryId)
    if (startIdx === -1 || endIdx === -1) return []
    return entries.slice(startIdx, endIdx + 1)
  }

  // Delete a chapter
  async deleteChapter(chapterId: string): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    await database.deleteChapter(chapterId)
    this.chapters = this.chapters.filter((ch) => ch.id !== chapterId)

    // Invalidate chapter cache
    this.invalidateChapterCache()

    log('Chapter deleted:', chapterId)
  }

  // Create a manual chapter at a specific entry index
  async createManualChapter(endEntryIndex: number): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    // Find the start index (after the last chapter or beginning)
    const startIndex = this.lastChapterEndIndex

    // Validate the end index
    if (endEntryIndex <= startIndex || endEntryIndex > this.ctx.entry.entries.length) {
      throw new Error('Invalid entry index for chapter creation')
    }

    // Get the entries for this chapter
    const chapterEntries = this.ctx.entry.entries.slice(startIndex, endEntryIndex)
    if (chapterEntries.length === 0) {
      throw new Error('No entries to create chapter from')
    }

    // Get previous chapters for context (branch-filtered)
    const previousChapters = [...this.currentBranchChapters].sort((a, b) => a.number - b.number)

    // Import aiService dynamically to avoid circular dependency
    const { aiService } = await import('$lib/services/ai')

    // Generate summary with previous chapters as context
    const chapterData = await aiService.summarizeChapter(
      chapterEntries,
      previousChapters,
      this.ctx.currentStory?.mode ?? 'adventure',
      this.ctx.generationContext.pov,
      this.ctx.generationContext.tense,
    )

    // Get the next chapter number
    const chapterNumber = await this.getNextChapterNumber()

    // Extract time range from entries' metadata
    const firstEntry = chapterEntries[0]
    const lastEntry = chapterEntries[chapterEntries.length - 1]
    const startTime = firstEntry.metadata?.timeStart ?? null
    const endTime = lastEntry.metadata?.timeEnd ?? null

    // Create the chapter
    const chapter: Chapter = {
      id: crypto.randomUUID(),
      storyId: this.ctx.currentStory.id,
      number: chapterNumber,
      title: chapterData.title || null,
      startEntryId: chapterEntries[0].id,
      endEntryId: chapterEntries[chapterEntries.length - 1].id,
      entryCount: chapterEntries.length,
      summary: chapterData.summary,
      startTime,
      endTime,
      keywords: chapterData.keywords,
      characters: chapterData.characters,
      locations: chapterData.locations,
      plotThreads: chapterData.plotThreads,
      emotionalTone: chapterData.emotionalTone || null,
      branchId: this.ctx.currentStory.currentBranchId,
      createdAt: Date.now(),
    }

    await this.addChapter(chapter)
    log('Manual chapter created:', chapter.number, chapter.title)
  }

  /**
   * Validate chapter integrity and repair issues.
   * Called after loading a story to ensure chapter data is consistent.
   * Returns true if repairs were made.
   */
  async validateChapterIntegrity(): Promise<boolean> {
    if (this.ctx.chapter.chapters.length === 0) return false

    let repairsMade = false
    const entryIdSet = new Set(this.ctx.entry.entries.map((e) => e.id))
    const chaptersToDelete: string[] = []

    // Sort chapters by number for proper validation
    const sortedChapters = [...this.ctx.chapter.chapters].sort((a, b) => a.number - b.number)

    for (const chapter of sortedChapters) {
      const hasValidStart = entryIdSet.has(chapter.startEntryId)
      const hasValidEnd = entryIdSet.has(chapter.endEntryId)

      if (!hasValidStart || !hasValidEnd) {
        log('Chapter has invalid entry references, marking for deletion', {
          chapterId: chapter.id,
          chapterNumber: chapter.number,
          hasValidStart,
          hasValidEnd,
          startEntryId: chapter.startEntryId,
          endEntryId: chapter.endEntryId,
        })
        chaptersToDelete.push(chapter.id)
        repairsMade = true
      }
    }

    // Delete invalid chapters from database and local state
    for (const chapterId of chaptersToDelete) {
      try {
        await database.deleteChapter(chapterId)
        log('Deleted invalid chapter:', chapterId)
      } catch (error) {
        log('Failed to delete invalid chapter:', chapterId, error)
      }
    }

    if (chaptersToDelete.length > 0) {
      this.ctx.chapter.chapters = this.ctx.chapter.chapters.filter(
        (ch) => !chaptersToDelete.includes(ch.id),
      )
      // Invalidate chapter cache after deletions
      this.invalidateChapterCache()
    }

    // Ensure chapters are sorted by number
    this.ctx.chapter.chapters = [...this.ctx.chapter.chapters].sort((a, b) => a.number - b.number)

    if (repairsMade) {
      log('Chapter integrity validation complete', {
        deletedChapters: chaptersToDelete.length,
        remainingChapters: this.ctx.chapter.chapters.length,
      })
    }

    return repairsMade
  }

  /**
   * Get chapters filtered by current branch and its lineage.
   * Includes main branch chapters plus any ancestor/current branch chapters.
   */
  get currentBranchChapters(): Chapter[] {
    const currentBranchId = this.ctx.currentStory?.currentBranchId ?? null

    // If on main branch, only return chapters with null branchId
    if (currentBranchId === null) {
      return this.chapters.filter((ch) => ch.branchId === null)
    }

    const lineage = this.ctx.branch.buildBranchLineage(currentBranchId)
    if (lineage.length === 0) {
      return this.chapters.filter((ch) => ch.branchId === null)
    }

    const lineageIds = new Set(lineage.map((branch) => branch.id))
    return this.chapters.filter((ch) => ch.branchId === null || lineageIds.has(ch.branchId))
  }

  get lastChapterEndIndex(): number {
    // Use branch-filtered chapters for this computation
    const branchChapters = this.currentBranchChapters
    if (branchChapters.length === 0) return 0

    // Check if cache is valid - invalidate if chapters or entries changed
    const chaptersChanged = this.chapters.length !== this._lastChaptersLength
    const entriesChanged = this.ctx.entry.entries.length !== this._lastEntriesLength

    if (chaptersChanged || entriesChanged || this._lastChapterEndIndexDirty) {
      this._lastChaptersLength = this.chapters.length
      this._lastEntriesLength = this.ctx.entry.entries.length
      this._cachedLastChapterEndIndex = this._computeLastChapterEndIndex()
      this._lastChapterEndIndexDirty = false
    }

    return this._cachedLastChapterEndIndex
  }

  get messagesSinceLastChapter(): number {
    return this.ctx.entry.entries.length - this.lastChapterEndIndex
  }

  /**
   * Compute lastChapterEndIndex - internal implementation.
   * Uses branch-filtered chapters for correct branch awareness.
   */
  private _computeLastChapterEndIndex(): number {
    // Use branch-filtered chapters
    const branchChapters = this.currentBranchChapters
    if (branchChapters.length === 0) return 0

    // Rebuild index map if needed
    if (this.ctx.entry._entryIdToIndex.size !== this.ctx.entry.entries.length) {
      this.ctx.entry.rebuildEntryIdIndex()
    }

    // Sort chapters by number to ensure we get the actual last chapter for this branch
    const sortedChapters = [...branchChapters].sort((a, b) => a.number - b.number)
    const lastChapter = sortedChapters[sortedChapters.length - 1]

    // Use O(1) map lookup instead of O(n) find + indexOf
    const endIndex = this.ctx.entry._entryIdToIndex.get(lastChapter.endEntryId)
    if (endIndex !== undefined) {
      return endIndex + 1
    }

    // Fallback: if endEntryId references a deleted entry, estimate based on entry counts
    console.warn('Warning: Chapter endEntryId not found, using fallback calculation', {
      chapterId: lastChapter.id,
      chapterNumber: lastChapter.number,
      endEntryId: lastChapter.endEntryId,
    })

    // Sum up all branch chapter entry counts as a fallback estimate
    const totalChapterEntries = sortedChapters.reduce((sum, ch) => sum + ch.entryCount, 0)
    return Math.min(totalChapterEntries, this.ctx.entry.entries.length)
  }

  /**
   * Invalidate lastChapterEndIndex cache - call when chapters change
   */
  invalidateChapterCache(): void {
    this._lastChapterEndIndexDirty = true
    this.ctx.entry._entryIdToIndex.clear() // Force rebuild on next access
  }
}
