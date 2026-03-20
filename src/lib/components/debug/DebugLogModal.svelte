<script lang="ts">
  import { debug, type DebugLogEntry } from '$lib/stores/debug.svelte'
  import { ExternalLink, RefreshCcw } from 'lucide-svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import DebugLogView from './DebugLogView.svelte'

  // Throttled snapshot of logs - only updates every 500ms when modal is open
  let throttledLogs = $state<DebugLogEntry[]>([])
  let lastUpdateTime = 0
  let pendingUpdate: ReturnType<typeof setTimeout> | null = null

  // Update throttled logs when modal opens or logs change (throttled)
  $effect(() => {
    if (!debug.debugModalOpen || debug.debugWindowActive) {
      if (pendingUpdate) {
        clearTimeout(pendingUpdate)
        pendingUpdate = null
      }
      return
    }

    const logs = debug.debugLogs
    const now = Date.now()
    const timeSinceLastUpdate = now - lastUpdateTime

    if (timeSinceLastUpdate >= 500) {
      throttledLogs = [...logs]
      lastUpdateTime = now
      if (pendingUpdate) {
        clearTimeout(pendingUpdate)
        pendingUpdate = null
      }
    } else if (!pendingUpdate) {
      pendingUpdate = setTimeout(() => {
        throttledLogs = [...debug.debugLogs]
        lastUpdateTime = Date.now()
        pendingUpdate = null
      }, 500 - timeSinceLastUpdate)
    }
  })

  // Sync immediately when modal opens
  $effect(() => {
    if (debug.debugModalOpen && !debug.debugWindowActive) {
      throttledLogs = [...debug.debugLogs]
      lastUpdateTime = Date.now()
    }
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
  <ResponsiveModal.Content class="flex h-[85vh] max-h-[85vh] flex-col gap-0 p-0 sm:max-w-4xl">
    <ResponsiveModal.Header class="border-border border-b px-6 py-4">
      <div class="flex w-full items-center justify-between">
        <div class="flex flex-1 items-center gap-4">
          <div class="flex items-center gap-2">
            <ResponsiveModal.Title>API Debug Logs</ResponsiveModal.Title>
            <span
              class="bg-secondary text-secondary-foreground rounded px-2 py-0.5 font-mono text-xs"
            >
              {debug.debugLogs.length}
            </span>
          </div>

          {#if !debug.debugWindowActive}
            <Button
              variant="ghost"
              size="icon"
              class="text-muted-foreground hover:text-foreground hidden h-8 w-8 md:inline-flex"
              onclick={handlePopOut}
              title="Pop out to separate window"
            >
              <ExternalLink class="h-4 w-4" />
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
            <ExternalLink class="h-8 w-8" />
          </div>
          <div class="space-y-2">
            <h3 class="text-lg font-medium">Logs are in an external window</h3>
            <p class="text-muted-foreground max-w-sm text-sm">
              The debug logs are currently being displayed in a separate window for your
              convenience.
            </p>
          </div>
          <Button variant="outline" class="gap-2" onclick={handlePopIn}>
            <RefreshCcw class="h-4 w-4" />
            Bring Back to Modal
          </Button>
        </div>
      {:else}
        <DebugLogView
          logs={throttledLogs}
          onClear={handleClearLogs}
          renderNewlines={debug.debugRenderNewlines}
          onToggleRenderNewlines={() => debug.toggleDebugRenderNewlines()}
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
