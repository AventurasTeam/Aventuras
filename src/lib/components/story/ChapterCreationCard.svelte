<script lang="ts">
  import { ask } from '@tauri-apps/plugin-dialog'
  import { ChevronUp, RotateCcw, Trash2, X } from '@lucide/svelte'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { story } from '#lib/stores/story.svelte.ts'
  import { settings } from '#lib/stores/settings.svelte.ts'
  import { activity } from '#lib/stores/activity.svelte.ts'
  import { chapterCards } from '#lib/stores/chapterCards.svelte.ts'
  import { formatDuration, turnDuration } from '#lib/services/activity/index.ts'
  import type { ChapterCard } from '#lib/services/chapterCreation/index.ts'
  import { runManualLoreManagement } from '#lib/services/generation/index.ts'
  import { reportRenderError } from '#lib/utils/activityDisplay.ts'
  import ActivitySummary from './ActivitySummary.svelte'
  import ActivityTimeline from './ActivityTimeline.svelte'

  let {
    card,
    onNavigate,
  }: {
    card: ChapterCard
    onNavigate: (entryId: string) => void
  } = $props()

  const record = $derived(
    settings.uiSettings.activityReporting !== 'off' ? activity.recordFor(card.recordKey) : null,
  )
  const showRecord = $derived(!!record && activity.isReportVisible(card.recordKey))
  const running = $derived(card.phase === 'summarizing' || card.phase === 'lore')
  const bannersOn = $derived(settings.uiSettings.showChapterBanners)
  const label = $derived(`Chapter ${card.number}`)
  const failed = $derived(card.phase === 'summary-failed' || card.phase === 'lore-incomplete')
  const status = $derived.by(() => {
    switch (card.phase) {
      case 'summarizing':
        return 'Writing a summary'
      case 'lore':
        return 'Updating the lorebook'
      case 'finished':
        return bannersOn ? 'Finished' : 'Chapter creation is finished'
      // A failure keeps the line of the stage it stopped in; the line marks it.
      case 'summary-failed':
        return 'Writing a summary'
      case 'lore-incomplete':
        return 'Updating the lorebook'
    }
  })
  let busy = $state(false)
  // Deleting any but the last chapter would leave its entries uncut for good.
  const isLast = $derived(!!card.chapterId && story.isLastChapter(card.chapterId))

  function dismiss() {
    chapterCards.cards.remove(card.id)
    activity.discardRecord(card.recordKey)
  }

  async function retrySummary() {
    if (busy) return
    busy = true
    try {
      await chapterCards.cards.retrySummary(card.id)
    } finally {
      busy = false
    }
  }

  async function restart() {
    const chapter = story.chapters.find((ch) => ch.id === card.chapterId)
    if (!chapter || busy) return
    busy = true
    try {
      chapterCards.cards.loreRestarted(card.id)
      const run = card.loreRuns + 1
      const recordId = activity.reopenRecord(card.recordKey)
      const result = await runManualLoreManagement(
        chapter,
        recordId
          ? { activity, placement: { recordId }, label: `Lore management (run ${run})` }
          : undefined,
      )
      if (recordId) activity.endRecord(recordId)
      if (result?.completed) chapterCards.cards.loreFinished(card.id)
      else {
        chapterCards.cards.loreIncomplete(
          card.id,
          result?.error ?? 'Lore management did not complete',
          result?.changeCount ?? 0,
        )
      }
    } finally {
      busy = false
    }
  }

  async function deleteChapter() {
    if (!card.chapterId || !isLast || busy) return
    const changes = card.loreChangeCount
    const kept =
      changes === 0
        ? 'The incomplete runs wrote no lore changes.'
        : `The ${changes === 1 ? 'lore change' : `${changes} lore changes`} the incomplete runs wrote ${changes === 1 ? 'stays' : 'stay'} in the lorebook.`
    const confirmed = await ask(
      `Delete ${label}${card.title ? `: ${card.title}` : ''}? Its entries remain, and a later turn can cut them into a chapter again. ${kept}`,
      { title: 'Delete incomplete chapter', kind: 'warning' },
    )
    if (!confirmed) return
    busy = true
    try {
      if (await story.deleteChapter(card.chapterId)) dismiss()
    } finally {
      busy = false
    }
  }
</script>

<section
  class="border-border border-t-primary/60 rounded-lg border border-t-2 px-4 pt-3 pb-2 shadow-sm {story.currentBgImage
    ? 'bg-card/60 backdrop-blur-md'
    : 'bg-card'}"
  aria-label="{label} creation"
>
  {#if !(card.phase === 'finished' && !bannersOn)}
    <div class="flex items-center gap-3">
      <span class="border-border flex-1 border-t"></span>
      <span class="text-primary text-xs font-semibold tracking-[0.2em] uppercase">{label}</span>
      <span class="border-border flex-1 border-t"></span>
    </div>

    {#if card.title}
      <h2 class="text-foreground font-story mt-2 text-center text-lg font-semibold">
        {card.title}
      </h2>
    {/if}
  {/if}

  <!-- A bystander to the card, as on an entry: a fault rendering it leaves the card standing. -->
  <svelte:boundary onerror={reportRenderError}>
    <p class="text-muted-foreground mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
      <span>
        {status}{#if failed}
          — <span class="text-red-700 dark:text-red-500">failed</span>{/if}
      </span>
      {#if record}
        <button
          type="button"
          class="bg-muted text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 text-[11px] tabular-nums transition-colors"
          aria-pressed={showRecord}
          title={showRecord ? 'Hide chapter creation activity' : 'Show chapter creation activity'}
          onclick={() => activity.setReportVisible(card.recordKey, !showRecord)}
        >
          {formatDuration(turnDuration(record, record.endedAt ?? activity.now))}
        </button>
      {/if}
    </p>

    {#if card.reason && !running}
      <p class="text-muted-foreground mt-1 text-xs break-words">{card.reason}</p>
    {/if}

    {#if record && showRecord}
      <div class="mt-2">
        <ActivitySummary turn={record} />
        {#if activity.isTreeExpanded(record)}
          <ActivityTimeline turn={record} now={activity.now} />
        {/if}
      </div>
    {/if}
  </svelte:boundary>

  {#if !running}
    <div class="mt-2 flex flex-wrap items-center justify-end gap-1">
      {#if card.phase === 'lore-incomplete'}
        <Button
          variant="text"
          size="sm"
          class="h-7 gap-1 px-2 text-xs"
          disabled={busy}
          onclick={restart}
        >
          <RotateCcw />
          Restart lore management
        </Button>
        <Button
          variant="text"
          size="sm"
          class="h-7 gap-1 px-2 text-xs"
          disabled={busy || !isLast}
          title={isLast
            ? undefined
            : 'A later chapter exists; only the last chapter can be deleted'}
          onclick={deleteChapter}
        >
          <Trash2 />
          Delete incomplete chapter
        </Button>
      {:else}
        {#if card.phase === 'finished' && bannersOn && card.chapterStartEntryId}
          <Button
            variant="text"
            size="sm"
            class="mr-auto h-7 gap-1 px-2 text-xs"
            onclick={() => onNavigate(card.chapterStartEntryId!)}
            aria-label="Go to {label}"
          >
            <ChevronUp />
            Go to {label}
          </Button>
        {/if}
        {#if card.phase === 'summary-failed' && card.retryable}
          <Button
            variant="text"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            disabled={busy}
            onclick={retrySummary}
          >
            <RotateCcw />
            Retry
          </Button>
        {/if}
        <Button variant="text" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={dismiss}>
          <X />
          Dismiss
        </Button>
      {/if}
    </div>
  {/if}
</section>
