<script lang="ts">
  import { onMount } from 'svelte'
  import { emit } from '@tauri-apps/api/event'
  import { debug } from '#lib/stores/debug.svelte.ts'
  import DebugLogView from '#lib/components/debug/DebugLogView.svelte'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Minimize2 } from '@lucide/svelte'

  onMount(() => {
    console.log('[DebugWin] Mounted')
    const ready = debug.connectAsDebugWindow()

    return async () => {
      console.log('[DebugWin] Unmounting')
      ;(await ready)()
    }
  })

  function handleClear() {
    console.log('[DebugWin] Requesting clear')
    emit('request-clear-debug-logs')
  }

  function handleToggleReadableView() {
    console.log('[DebugWin] Requesting toggle render newlines')
    emit('request-toggle-debug-readable-view')
  }

  function handlePopIn() {
    console.log('[DebugWin] Requesting pop-in')
    emit('pop-in-debug')
  }
</script>

<svelte:head>
  <title>API Debug Logs</title>
</svelte:head>

<div class="bg-background flex h-dvh flex-col overflow-hidden">
  <!-- Window Header -->
  <div class="border-border bg-card flex items-center justify-between border-b px-6 py-4">
    <div class="flex items-center gap-3">
      <h1 class="text-lg font-semibold">API Debug Logs</h1>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="gap-2" onclick={handlePopIn}>
        <Minimize2 class="size-4" />
        Pop In
      </Button>
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-hidden">
    <DebugLogView onClear={handleClear} onToggleReadableView={handleToggleReadableView} />
  </div>
</div>
