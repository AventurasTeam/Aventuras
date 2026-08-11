<script lang="ts">
  import type { Chapter } from '$lib/types'
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { aiService } from '$lib/services/ai'
  import { runManualLoreManagement } from '$lib/services/generation'
  import MemoryHeader from './MemoryHeader.svelte'
  import MemorySettings from './MemorySettings.svelte'
  import ChapterCard from './ChapterCard.svelte'
  import ManualChapterModal from './ManualChapterModal.svelte'
  import ResummarizeModal from './ResummarizeModal.svelte'
  import { BookOpen, ArrowLeft } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { EmptyState } from '$lib/components/ui/empty-state'

  // Get chapters sorted by number (descending - newest first)

  const sortedChapters = $derived([...story.chapters].sort((a, b) => b.number - a.number))

  // Get entries for each chapter
  function getChapterEntries(chapter: Chapter) {
    return story.getChapterEntries(chapter)
  }

  // Handle manual chapter creation
  async function handleCreateManualChapter(endEntryIndex: number) {
    ui.setMemoryLoading(true)
    try {
      const created = await story.createManualChapter(endEntryIndex)
      ui.closeManualChapterModal()

      // A refused creation leaves nothing new to read: the pass would be a wasted call.
      if (created) void runManualLoreManagement()
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
        story.memoryConfig.summaryDetail,
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
