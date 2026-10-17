<script lang="ts">
  import type { StoryEntry } from '#lib/types/index.ts'
  import { loreLine, type RevertKeep } from '#lib/services/stateTracking/index.ts'
  import { story, type RevertPreview } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Checkbox } from '#lib/components/ui/checkbox/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { RotateCcw, X } from '@lucide/svelte'
  import ChangeList from './ChangeList.svelte'

  // Set only while the reader decides: a regenerate with nothing to decide runs at once.
  let pending = $state<{ entry: StoryEntry; retry: boolean; preview: RevertPreview } | null>(null)
  let keepManual = $state(true)
  let keepTidy = $state(true)

  $effect(() => {
    const request = ui.regenerateRequest
    if (!request) return
    ui.requestRegenerate(null)
    void start(request.entryId, request.retry)
  })

  function regenerate(entryId: string, retry: boolean, keep?: RevertKeep) {
    if (retry) void ui.triggerRetryLastMessage(keep)
    else void ui.triggerRegenerateNarration(entryId, keep)
  }

  async function start(entryId: string, retry: boolean) {
    const entry = story.entries.find((e) => e.id === entryId)
    if (!entry) return
    const position = retry ? ui.retryBackup?.entryCountBeforeAction : entry.position
    let preview: RevertPreview | null = null
    try {
      if (position !== undefined) preview = await story.previewRegenerate(position)
    } catch (error) {
      console.error('[RegenerateEntryModal] Could not preview the regenerate:', error)
      ui.showToast(`Could not check what regenerating undoes: ${errMessage(error)}`, 'error')
      return
    }
    if (!preview || preview.manual.length + preview.tidy.length + preview.lore.length === 0) {
      regenerate(entryId, retry)
      return
    }
    keepManual = true
    keepTidy = true
    pending = { entry, retry, preview }
  }

  function confirm() {
    if (!pending) return
    const { entry, retry } = pending
    pending = null
    regenerate(entry.id, retry, { manual: keepManual, tidy: keepTidy })
  }
</script>

<ResponsiveModal.Root
  bind:open={
    () => pending !== null,
    (next) => {
      if (!next) pending = null
    }
  }
>
  <ResponsiveModal.Content
    class="flex max-h-[85dvh] max-w-md flex-col gap-0 p-0"
    interactOutsideBehavior="ignore"
  >
    {#if pending}
      {@const preview = pending.preview}
      {@const othersListed = preview.manual.length + preview.tidy.length > 0}
      {@const line = loreLine(preview.lore, othersListed)}
      <ResponsiveModal.Header class="border-b px-6 py-4" closeButton={false}>
        <ResponsiveModal.Title>Regenerate entry {entryNumber(pending.entry)}</ResponsiveModal.Title>
        <ResponsiveModal.Description>
          Regenerating this entry undoes the world state changes recorded for it.
        </ResponsiveModal.Description>
      </ResponsiveModal.Header>
      <!-- Buttons scroll with the content, so what they do is read before them. -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="space-y-3 px-6 py-4">
          {#if line}
            <p class="text-muted-foreground text-sm">{line}</p>
          {/if}
          {#if othersListed}
            <p class="text-muted-foreground text-sm">Regenerating would also undo these changes:</p>
            {#if preview.manual.length > 0}
              <p class="text-muted-foreground text-xs">Changes you made by hand:</p>
              <ChangeList changes={preview.manual} unkeepable={preview.unkeepable} />
              <label class="flex items-center gap-2 text-xs">
                <Checkbox bind:checked={keepManual} />
                Keep them
              </label>
            {/if}
            {#if preview.tidy.length > 0}
              <p class="text-muted-foreground text-xs">Changes from lore management you ran:</p>
              <ChangeList changes={preview.tidy} unkeepable={preview.unkeepable} />
              <label class="flex items-center gap-2 text-xs">
                <Checkbox bind:checked={keepTidy} />
                Keep them
              </label>
            {/if}
          {/if}
        </div>
        <ResponsiveModal.Footer class="border-t px-6 py-4">
          <Button variant="secondary" size="sm" onclick={() => (pending = null)} class="h-9 px-3">
            <X class="mr-1.5 h-4 w-4" />
            Cancel
          </Button>
          <Button size="sm" onclick={confirm} class="h-9 px-3">
            <RotateCcw class="mr-1.5 h-4 w-4" />
            Regenerate
          </Button>
        </ResponsiveModal.Footer>
      </div>
    {/if}
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
