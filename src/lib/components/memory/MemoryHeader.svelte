<script lang="ts">
  import { story } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { chapterCards } from '#lib/stores/chapterCards.svelte.ts'
  import { isLoreManagementRunning } from '#lib/services/generation/index.ts'
  import { Plus, Settings } from '@lucide/svelte'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Card, CardContent } from '#lib/components/ui/card/index.ts'
  import { Progress } from '#lib/components/ui/progress/index.ts'
  import { Switch } from '#lib/components/ui/switch/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'
  import { cn } from '#lib/utils/cn.ts'

  interface Props {
    onCreateChapter?: () => void
  }

  let { onCreateChapter }: Props = $props()

  const tokensOutsideBuffer = $derived(story.tokensOutsideBuffer)
  const threshold = $derived(story.memoryConfig.tokenThreshold)
  const autoSummarize = $derived(story.memoryConfig.autoSummarize)
  const messagesSinceLastChapter = $derived(story.messagesSinceLastChapter)
  // Why a chapter cannot be made by hand now. A chapter cut over a range still being cut, or
  // while a lore session holds the branch, would overlap it or lose its own lore session.
  const unavailableReason = $derived.by(() => {
    const current = story.currentStory
    if (!current) return null
    const branchId = current.currentBranchId ?? null
    // The run set is not reactive; this flag starts and ends with every run.
    void ui.loreManagementActive
    if (
      ui.chapterCheckActiveFor(current.id, branchId) ||
      chapterCards.pending(current.id, branchId)
    )
      return 'A chapter is being written on this branch.'
    if (isLoreManagementRunning(current.id, branchId))
      return 'Lore management is running on this branch.'
    if (ui.backgroundTasksActiveFor(current.id, current.currentBranchId))
      return "This turn's background tasks are still running."
    if (messagesSinceLastChapter === 0) return 'No new entries since the last chapter.'
    return null
  })
  const bufferSize = $derived(story.memoryConfig.chapterBuffer)

  const percentage = $derived(
    threshold > 0 ? Math.min(100, Math.round((tokensOutsideBuffer / threshold) * 100)) : 0,
  )
  const isNearThreshold = $derived(percentage >= 80)
  const isOverThreshold = $derived(percentage >= 100)

  function formatNumber(num: number): string {
    return num.toLocaleString()
  }

  async function toggleAutoSummarize() {
    await story.updateMemoryConfig({ autoSummarize: !autoSummarize })
  }

  function handleCreateChapter() {
    if (onCreateChapter) {
      onCreateChapter()
    } else {
      ui.openManualChapterModal()
    }
  }
</script>

<Card>
  <CardContent class="space-y-4 p-4">
    <!-- Token Usage Section -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <Label class="text-muted-foreground">Context Usage</Label>
        <div class="flex items-center gap-2">
          <Label
            for="auto-summarize"
            class="cursor-pointer text-xs {autoSummarize
              ? 'text-primary'
              : 'text-muted-foreground'}"
          >
            Auto-summarize
          </Label>
          <Switch
            id="auto-summarize"
            checked={autoSummarize}
            onCheckedChange={toggleAutoSummarize}
          />
        </div>
      </div>

      <!-- Progress Bar -->
      <Progress
        value={percentage}
        class="h-3"
        indicatorClass={cn(
          'transition-all duration-300',
          !isNearThreshold && 'bg-primary',
          isNearThreshold && !isOverThreshold && 'bg-amber-500',
          isOverThreshold && 'bg-red-500',
        )}
      />

      <!-- Token Count -->
      <div
        class="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-0"
      >
        <span class="text-muted-foreground">
          <span class="text-foreground font-medium">{formatNumber(tokensOutsideBuffer)}</span>
          <span class="text-muted-foreground/70"> / {formatNumber(threshold)}</span>
          <span class="text-muted-foreground/70"> tokens</span>
        </span>
        <span class="text-muted-foreground text-xs sm:text-sm">
          {messagesSinceLastChapter} messages
          {#if bufferSize > 0}
            <span class="text-muted-foreground/70">({bufferSize} protected)</span>
          {/if}
        </span>
      </div>
    </div>

    <!-- Actions Row -->
    <div class="flex items-center gap-2">
      <Button
        class="flex-1 gap-2"
        onclick={handleCreateChapter}
        disabled={ui.memoryLoading || unavailableReason !== null}
        title={unavailableReason ?? undefined}
      >
        <Plus class="h-4 w-4" />
        <span>Create Chapter Now</span>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        class={cn(ui.memorySettingsOpen && 'bg-accent text-accent-foreground')}
        onclick={() => ui.toggleMemorySettings()}
        title="Memory Settings"
      >
        <Settings class="h-5 w-5" />
      </Button>
    </div>
    <!-- Shown as well as the title: a touch screen never shows a tooltip. -->
    {#if unavailableReason && !ui.memoryLoading}
      <p class="text-muted-foreground text-xs">{unavailableReason}</p>
    {/if}
  </CardContent>
</Card>
