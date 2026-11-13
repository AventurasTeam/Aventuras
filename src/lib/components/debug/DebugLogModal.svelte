<script lang="ts">
  import { debug } from '#lib/stores/debug.svelte.ts'
  import { ExternalLink, RefreshCcw } from '@lucide/svelte'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import DebugLogView from './DebugLogView.svelte'
  import { MODAL_CLOSE_TRANSITION_MS } from '#lib/constants/layout.ts'

  let showContent = $state(false)

  $effect(() => {
    if (debug.debugModalOpen && !debug.debugWindowActive) {
      showContent = true
      return
    }

    // Unmount the log view after the close transition: it holds the whole session's log, and
    // the Android WebView heap is a hard cap.
    const timer = setTimeout(() => (showContent = false), MODAL_CLOSE_TRANSITION_MS)
    return () => clearTimeout(timer)
  })

  function handleClearLogs() {
    debug.clearDebugLogs()
  }

  async function handlePopOut() {
    await debug.popOutDebug()
  }

  async function handlePopIn() {
    await debug.popInDebug()
  }
</script>

<ResponsiveModal.Root bind:open={debug.debugModalOpen}>
  <ResponsiveModal.Content class="flex h-[85dvh] max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-4xl">
    <ResponsiveModal.Header class="border-border border-b px-6 py-4">
      <div class="flex w-full items-center justify-between">
        <div class="flex flex-1 items-center gap-4">
          <div class="flex items-center gap-2">
            <ResponsiveModal.Title>API Debug Logs</ResponsiveModal.Title>
          </div>

          {#if !debug.debugWindowActive}
            <Button
              variant="ghost"
              size="icon"
              class="text-muted-foreground hover:text-foreground hidden size-8 md:inline-flex"
              onclick={handlePopOut}
              title="Pop out to separate window"
            >
              <ExternalLink class="size-4" />
            </Button>
          {/if}
        </div>
      </div>
      <ResponsiveModal.Description class="sr-only">
        Logs of API requests and responses
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    <div class="flex flex-1 flex-col overflow-hidden">
      {#if debug.debugWindowActive}
        <div class="flex flex-1 flex-col items-center justify-center space-y-4 p-8 text-center">
          <div class="rounded-full bg-blue-500/10 p-4 text-blue-400">
            <ExternalLink class="size-8" />
          </div>
          <div class="space-y-2">
            <h3 class="text-lg font-medium">Logs are in an external window</h3>
            <p class="text-muted-foreground max-w-sm text-sm">
              The debug logs are currently being displayed in a separate window for your
              convenience.
            </p>
          </div>
          <Button variant="outline" class="gap-2" onclick={handlePopIn}>
            <RefreshCcw class="size-4" />
            Bring Back to Modal
          </Button>
        </div>
      {:else if showContent}
        <DebugLogView
          onClear={handleClearLogs}
          onToggleReadableView={() => debug.toggleReadableView()}
        />
      {/if}
    </div>

    <ResponsiveModal.Footer class="border-border bg-muted/10 mt-auto border-t px-6 py-3">
      <p class="text-muted-foreground w-full text-center text-xs md:text-left">
        Logs are stored in memory only.
      </p>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
