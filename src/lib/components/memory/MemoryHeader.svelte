<script lang="ts">
  import { story } from '$lib/stores/story/index.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { Plus, Settings } from 'lucide-svelte'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import { Progress } from '$lib/components/ui/progress'
  import { Switch } from '$lib/components/ui/switch'
  import { Label } from '$lib/components/ui/label'
  import { cn } from '$lib/utils/cn'

  interface Props {
    onCreateChapter?: () => void
  }

  let { onCreateChapter }: Props = $props()

  const tokensOutsideBuffer = $derived(story.generationContext.tokensOutsideBuffer)
  const threshold = $derived(story.generationContext.memoryConfig.tokenThreshold)
  const autoSummarize = $derived(story.generationContext.memoryConfig.autoSummarize)
  const messagesSinceLastChapter = $derived(story.chapter.messagesSinceLastChapter)
  const bufferSize = $derived(story.generationContext.memoryConfig.chapterBuffer)

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
        disabled={ui.memoryLoading || messagesSinceLastChapter === 0}
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
  </CardContent>
</Card>
