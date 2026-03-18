<script lang="ts">
  import type { Chapter } from '$lib/types'
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { aiService } from '$lib/services/ai'
  import MemoryHeader from './MemoryHeader.svelte'
  import MemorySettings from './MemorySettings.svelte'
  import ChapterCard from './ChapterCard.svelte'
  import ManualChapterModal from './ManualChapterModal.svelte'
  import ResummarizeModal from './ResummarizeModal.svelte'
  import { BookOpen, ArrowLeft } from 'lucide-svelte'
  import { Button } from '$lib/components/ui/button'
  import { EmptyState } from '$lib/components/ui/empty-state'

  // Get chapters sorted by number (descending - newest first)

  const sortedChapters = $derived([...story.chapters].sort((a, b) => b.number - a.number))

  // Get entries for each chapter
  function getChapterEntries(chapter: Chapter) {
    return story.getChapterEntries(chapter)
  }

  /**
   * Run lore management after manual chapter creation.
   * Same as ActionInput's lore management, triggered per design doc section 3.4.
   */
  async function runLoreManagement() {
    if (!story.currentStory) return

    console.log('[MemoryView] Starting lore management...')
    ui.startLoreManagement()

    let changeCount = 0
    const bumpChanges = (delta = 1) => {
      changeCount += delta
      return changeCount
    }

    try {
      const result = await aiService.runLoreManagement(
        story.currentStory.id,
        story.currentStory.currentBranchId,
        [...story.lorebookEntries],
        [],
        story.chapters,
        {
          onCreateEntry: async (entry) => {
            await story.addLorebookEntry({
              name: entry.name,
              type: entry.type,
              description: entry.description,
              hiddenInfo: entry.hiddenInfo,
              aliases: entry.aliases,
              state: entry.state,
              adventureState: entry.adventureState,
              creativeState: entry.creativeState,
              injection: entry.injection,
              firstMentioned: entry.firstMentioned,
              lastMentioned: entry.lastMentioned,
              mentionCount: entry.mentionCount,
              createdBy: entry.createdBy,
              loreManagementBlacklisted: entry.loreManagementBlacklisted,
            })
            ui.updateLoreManagementProgress('Creating entries...', bumpChanges())
          },
          onUpdateEntry: async (id, updates) => {
            await story.updateLorebookEntry(id, updates)
            ui.updateLoreManagementProgress('Updating entries...', bumpChanges())
          },
          onDeleteEntry: async (id) => {
            await story.deleteLorebookEntry(id)
            ui.updateLoreManagementProgress('Cleaning up entries...', bumpChanges())
          },
          onMergeEntries: async (entryIds, mergedEntry) => {
            await story.deleteLorebookEntries(entryIds)
            await story.addLorebookEntry({
              name: mergedEntry.name,
              type: mergedEntry.type,
              description: mergedEntry.description,
              hiddenInfo: mergedEntry.hiddenInfo,
              aliases: mergedEntry.aliases,
              state: mergedEntry.state,
              adventureState: mergedEntry.adventureState,
              creativeState: mergedEntry.creativeState,
              injection: mergedEntry.injection,
              firstMentioned: mergedEntry.firstMentioned,
              lastMentioned: mergedEntry.lastMentioned,
              mentionCount: mergedEntry.mentionCount,
              createdBy: mergedEntry.createdBy,
              loreManagementBlacklisted: mergedEntry.loreManagementBlacklisted,
            })
            ui.updateLoreManagementProgress('Merging entries...', bumpChanges())
          },
          onQueryChapter: async (chapterNumber, question) => {
            return aiService.answerChapterQuestion(
              chapterNumber,
              question,
              story.currentBranchChapters,
              story.getChapterEntries.bind(story),
            )
          },
        },
        story.currentStory?.mode ?? 'adventure',
        story.pov,
        story.tense,
      )

      console.log('[MemoryView] Lore management complete', {
        changesCount: result.changes.length,
        summary: result.summary,
      })

      ui.updateLoreManagementProgress(`Complete: ${result.summary}`, result.changes.length)
    } finally {
      setTimeout(() => {
        ui.finishLoreManagement()
      }, 2000)
    }
  }

  // Handle manual chapter creation
  async function handleCreateManualChapter(endEntryIndex: number) {
    ui.setMemoryLoading(true)
    try {
      await story.createManualChapter(endEntryIndex)
      ui.closeManualChapterModal()

      // Trigger lore management after successful chapter creation
      runLoreManagement().catch((err) => {
        console.error('[MemoryView] Lore management failed:', err)
        ui.finishLoreManagement()
      })
    } finally {
      ui.setMemoryLoading(false)
    }
  }

  // Handle resummarization
  async function handleResummarize(chapter: Chapter) {
    ui.openResummarizeModal(chapter.id)
  }

  async function confirmResummarize() {
    const chapterId = ui.resummarizeChapterId
    if (!chapterId) return

    const chapter = story.chapters.find((c) => c.id === chapterId)
    if (!chapter) return

    ui.setMemoryLoading(true)
    try {
      const entries = getChapterEntries(chapter)
      const newSummary = await aiService.resummarizeChapter(
        chapter,
        entries,
        story.chapters,
        story.currentStory?.mode ?? 'adventure',
        story.pov,
        story.tense,
      )

      // Update the chapter with new summary and metadata
      await story.updateChapter(chapter.id, {
        summary: newSummary.summary,
        title: newSummary.title,
        keywords: newSummary.keywords,
        characters: newSummary.characters,
        locations: newSummary.locations,
        plotThreads: newSummary.plotThreads,
        emotionalTone: newSummary.emotionalTone,
      })

      ui.closeResummarizeModal()
    } catch (error) {
      console.error('Failed to resummarize chapter:', error)
    } finally {
      ui.setMemoryLoading(false)
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- Back to Story Header -->
  <div class="px-2 pt-0 pb-0 sm:pt-2">
    <Button
      variant="ghost"
      class="text-muted-foreground hover:text-foreground flex items-center gap-2 pl-2 text-xs"
      onclick={() => ui.setActivePanel('story')}
    >
      <ArrowLeft class="h-3.5 w-3.5" />
      <span>Back to Story</span>
    </Button>
  </div>

  <!-- Scrollable Content -->
  <div class="flex-1 space-y-4 overflow-y-auto px-2 py-0 sm:px-4 sm:py-2">
    <!-- Header with context usage -->
    <MemoryHeader />

    <!-- Collapsible Settings -->
    <MemorySettings />

    <!-- Chapter List -->
    {#if sortedChapters.length > 0}
      <div class="space-y-3">
        {#each sortedChapters as chapter (chapter.id)}
          <ChapterCard
            {chapter}
            entries={getChapterEntries(chapter)}
            onResummarize={handleResummarize}
          />
        {/each}
      </div>
    {:else}
      <!-- Empty State -->
      <div class="py-12">
        <EmptyState
          icon={BookOpen}
          title="No Chapters Yet"
          description="Chapters are created automatically when the story grows beyond the token threshold, or you can create one manually using the button above."
        />
      </div>
    {/if}
  </div>

  <!-- Modals -->
  {#if ui.manualChapterModalOpen}
    <ManualChapterModal
      onConfirm={handleCreateManualChapter}
      onClose={() => ui.closeManualChapterModal()}
    />
  {/if}

  {#if ui.resummarizeModalOpen}
    <ResummarizeModal
      chapterId={ui.resummarizeChapterId}
      onConfirm={confirmResummarize}
      onClose={() => ui.closeResummarizeModal()}
    />
  {/if}
</div>
