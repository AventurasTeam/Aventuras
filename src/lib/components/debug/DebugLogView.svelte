<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import { debug, type DebugLogEntry } from '#lib/stores/debug.svelte.ts'
  import {
    ArrowUpCircle,
    ArrowDownCircle,
    ArrowUp,
    Copy,
    Check,
    Filter,
    CirclePlus,
    Trash2,
    WrapText,
    Download,
  } from '@lucide/svelte'
  import { writeTextFile } from '@tauri-apps/plugin-fs'
  import { resolveSaveTarget } from '#lib/services/exportTarget.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { PROMPT_TEMPLATES } from '#lib/services/prompts/templates/index.ts'
  import * as Select from '#lib/components/ui/select/index.ts'
  import { Badge } from '#lib/components/ui/badge/index.ts'
  import { Separator } from '#lib/components/ui/separator/index.ts'
  import { Autocomplete } from '#lib/components/ui/autocomplete/index.ts'
  import { cn } from '#lib/utils/cn.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { DebugJsonCache, safeStringify } from './debugJson'

  interface Props {
    onClear?: () => void
    onToggleReadableView?: () => void
  }

  let { onClear, onToggleReadableView }: Props = $props()

  // `id` is the request's id, whether or not the request itself is still in the list.
  type LogGroup = { id: string; request?: DebugLogEntry; response?: DebugLogEntry }
  type ScrollAnchor = { id: string; offset: number }

  /** Window between snapshots of the store's log. */
  const THROTTLE_MS = 1200

  // Raw: entries are replaced, never mutated, and their bodies are large.
  let logs = $state.raw<DebugLogEntry[]>([])
  const jsonCache = new DebugJsonCache()

  let copiedId = $state<string | null>(null)
  let exporting = $state(false)
  let exported = $state(false)
  let exportError = $state<string | null>(null)
  let selectedCategories = $state<string[]>([])
  let scrollContainer: HTMLDivElement | null = $state(null)
  let userScrolledAway = $state(false)

  // Pagination
  let requestedPage = $state(1)
  let pageSize = $state(20)

  let lastSnapshotAt = 0
  let pendingSnapshot: ReturnType<typeof setTimeout> | null = null

  function setCategories(next: string[]) {
    selectedCategories = next
    requestedPage = 1
  }

  function setPageSize(next: number) {
    pageSize = next
    requestedPage = 1
  }

  function findAnchor(container: HTMLElement): ScrollAnchor | null {
    const top = container.getBoundingClientRect().top
    for (const row of container.querySelectorAll<HTMLElement>('[data-log-id]')) {
      const rect = row.getBoundingClientRect()
      const id = row.dataset.logId
      if (id && rect.bottom > top) return { id, offset: rect.top - top }
    }
    return null
  }

  function restoreAnchor(container: HTMLElement, anchor: ScrollAnchor | null) {
    if (!anchor) return
    const row = container.querySelector<HTMLElement>(`[data-log-id="${CSS.escape(anchor.id)}"]`)
    if (!row) return
    const offset = row.getBoundingClientRect().top - container.getBoundingClientRect().top
    container.scrollTop += offset - anchor.offset
  }

  async function applySnapshot(next: DebugLogEntry[]) {
    lastSnapshotAt = Date.now()
    const container = scrollContainer
    const following = currentPage === 1 && !userScrolledAway
    // Ids, not lengths or identities: the log is capped, and a merge replaces the newest entry.
    const hasNewer = next.at(-1)?.id !== logs.at(-1)?.id
    // Stable row keys let engines with scroll anchoring keep the reader's place.
    const anchor =
      container && !following && !CSS.supports('overflow-anchor', 'auto')
        ? findAnchor(container)
        : null

    logs = next
    // A list that shrank may have clamped the view; keep it from drifting back on regrowth.
    requestedPage = currentPage

    if (!container) return
    if (following) {
      if (!hasNewer) return
      await tick()
      container.scrollTop = 0
    } else if (anchor) {
      await tick()
      restoreAnchor(container, anchor)
    }
  }

  $effect(() => {
    void debug.logsVersion

    // Only `logsVersion` may trigger a snapshot; scrolling and paging must not.
    untrack(() => {
      const elapsed = Date.now() - lastSnapshotAt

      // An empty list on either side is applied at once: the pop-out mounts before its
      // first batch arrives, and a clear should not linger.
      if (elapsed >= THROTTLE_MS || logs.length === 0 || debug.logCount === 0) {
        if (pendingSnapshot) clearTimeout(pendingSnapshot)
        pendingSnapshot = null
        void applySnapshot(debug.getSnapshot())
      } else if (!pendingSnapshot) {
        pendingSnapshot = setTimeout(() => {
          pendingSnapshot = null
          void applySnapshot(debug.getSnapshot())
        }, THROTTLE_MS - elapsed)
      }
    })
  })

  onDestroy(() => {
    if (pendingSnapshot) clearTimeout(pendingSnapshot)
  })

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })
  }

  function formatDuration(duration: number | undefined): string {
    if (duration === undefined) return ''
    if (duration < 1000) return `${duration}ms`
    return `${(duration / 1000).toFixed(2)}s`
  }

  /**
   * Write every log entry to a JSON file. Exports the full set, not the current filter:
   * the point is to hand the whole session to someone else.
   */
  async function exportLogs() {
    const all = debug.getSnapshot()
    if (all.length === 0 || exporting) return
    exporting = true
    try {
      const content = safeStringify({
        exportedAt: new Date().toISOString(),
        count: all.length,
        logs: all,
      })
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const target = await resolveSaveTarget(`aventura-debug-${stamp}.json`, [
        { name: 'JSON', extensions: ['json'] },
      ])
      if (!target) return // cancelled
      await writeTextFile(target.destPath, content)
      exported = true
      setTimeout(() => (exported = false), 2000)
    } catch (err) {
      console.error('[DebugLogView] Failed to export logs:', err)
      exportError = errMessage(err)
      setTimeout(() => (exportError = null), 4000)
    } finally {
      exporting = false
    }
  }

  function formatJson(entry: DebugLogEntry): string {
    return jsonCache.get(entry, debug.readableView).text
  }

  function hasJsonText(entry: DebugLogEntry): boolean {
    return jsonCache.get(entry, debug.readableView).jsonText
  }

  async function copyToClipboard(entry: DebugLogEntry) {
    try {
      const text = formatJson(entry)
      await navigator.clipboard.writeText(text)
      copiedId = entry.id
      setTimeout(() => {
        if (copiedId === entry.id) copiedId = null
      }, 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }

  let categories = $derived.by(() => {
    const templateIds = new Set(PROMPT_TEMPLATES.map((t) => t.id))
    const logServiceNames = new Set(logs.map((l) => l.serviceName))
    const all = new Set([...templateIds, ...logServiceNames])
    return [...all].toSorted()
  })

  let groupedLogs = $derived.by(() => {
    let currentLogs = logs

    if (selectedCategories.length > 0) {
      currentLogs = currentLogs.filter((l) => selectedCategories.includes(l.serviceName))
    }

    const groups: LogGroup[] = []
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- SvelteMap cannot be mutated inside $derived (state_unsafe_mutation)
    const requestMap = new Map<string, number>()

    for (const log of currentLogs) {
      if (log.type === 'request') {
        groups.push({ id: log.id, request: log })
        requestMap.set(log.id, groups.length - 1)
      } else {
        const requestId = log.id.replace('-response', '')
        const groupIndex = requestMap.get(requestId)
        if (groupIndex !== undefined) {
          groups[groupIndex].response = log
        } else {
          groups.push({ id: requestId, response: log })
        }
      }
    }

    return groups.toReversed()
  })

  let requestCount = $derived(groupedLogs.filter((g) => g.request).length)
  let totalRequests = $derived(logs.filter((l) => l.type === 'request').length)

  let totalPages = $derived(Math.ceil(groupedLogs.length / pageSize) || 1)
  // Clamped, so a shrinking list (a clear, a narrower filter) never strands the view past the end.
  let currentPage = $derived(Math.min(requestedPage, totalPages))

  let pagedLogs = $derived.by(() => {
    const start = (currentPage - 1) * pageSize
    return groupedLogs.slice(start, start + pageSize)
  })

  function scrollToTop() {
    if (!scrollContainer) return
    scrollContainer.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function isNearTop(): boolean {
    if (!scrollContainer) return true
    return scrollContainer.scrollTop < 50
  }

  function handleScroll() {
    if (!scrollContainer) return
    userScrolledAway = !isNearTop()
  }
</script>

<div class="bg-background flex h-full flex-col overflow-hidden">
  <!-- Toolbar -->
  <div class="border-border bg-card/50 flex items-center justify-between border-b px-6 py-3">
    <div class="flex items-center gap-2">
      <span
        class="bg-secondary text-secondary-foreground rounded px-2 py-0.5 font-mono text-xs whitespace-nowrap"
      >
        {requestCount}
        {#if selectedCategories.length > 0}
          <span class="hidden sm:inline">of {totalRequests}</span>
        {/if}
      </span>
      <Filter class="text-muted-foreground size-3.5" />
      <Autocomplete
        items={categories}
        selected={selectedCategories}
        onSelect={(val) => setCategories(val as string[])}
        multiple
        placeholder="Services"
        class="bg-muted/20 h-8 w-48 shrink-0 border-dashed"
        itemLabel={(c) => c}
        itemValue={(c) => c}
      >
        {#snippet triggerSnippet()}
          <div class="flex items-center gap-2">
            <CirclePlus class="size-4 opacity-50" />
            <span class="text-xs">Services</span>
          </div>
        {/snippet}
        {#snippet itemSnippet(cat)}
          {@const isSelected = selectedCategories.includes(cat)}
          <div
            class={cn(
              'border-primary mr-2 flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
              isSelected ? 'bg-primary text-primary-foreground' : 'opacity-50 [&_svg]:invisible',
            )}
          >
            <Check class="size-4" />
          </div>
          <span class="truncate text-xs">{cat}</span>
        {/snippet}
      </Autocomplete>

      {#if selectedCategories.length > 0}
        <Separator orientation="vertical" class="mx-1 h-4" />
        <div class="flex flex-wrap items-center gap-1.5">
          {#each selectedCategories as cat, i (i)}
            <Badge
              variant="secondary"
              class="hover:bg-secondary/80 flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-normal transition-colors"
              onclick={() => setCategories(selectedCategories.filter((c) => c !== cat))}
            >
              {cat}
              <Trash2 class="size-3 opacity-50 hover:opacity-100" />
            </Badge>
          {/each}
          <Button
            variant="ghost"
            size="sm"
            class="text-muted-foreground h-6 px-1.5 text-[10px] font-medium transition-colors hover:text-red-400"
            onclick={() => setCategories([])}
          >
            Clear all
          </Button>
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if onToggleReadableView}
        <Button
          variant="ghost"
          size="icon"
          class={debug.readableView
            ? 'text-blue-400 hover:text-blue-500'
            : 'text-muted-foreground hover:text-foreground'}
          onclick={onToggleReadableView}
          title={debug.readableView ? 'Show raw strings' : 'Render newlines and expand JSON text'}
        >
          <WrapText class="size-4" />
        </Button>
      {/if}

      <Button
        variant="ghost"
        size="icon"
        class="text-muted-foreground hover:text-foreground size-8"
        onclick={exportLogs}
        disabled={logs.length === 0 || exporting}
        title={exportError ?? 'Export all log entries as JSON'}
      >
        {#if exported}
          <Check class="size-4 text-green-400" />
        {:else}
          <Download class={cn('size-4', exportError && 'text-red-400')} />
        {/if}
      </Button>

      {#if onClear}
        <Button
          variant="ghost"
          size="icon"
          class="text-muted-foreground size-8 hover:bg-red-900/10 hover:text-red-400"
          onclick={onClear}
          title="Clear all logs"
        >
          <Trash2 class="size-4" />
        </Button>
      {/if}
    </div>
  </div>

  <!-- Logs Area -->
  <div
    class="relative flex-1 overflow-y-auto px-6 py-4"
    bind:this={scrollContainer}
    onscroll={handleScroll}
  >
    {#if pagedLogs.length === 0}
      <div class="text-muted-foreground flex h-48 flex-col items-center justify-center text-sm">
        <p>No API requests matching the current filter.</p>
      </div>
    {:else}
      <div class="space-y-4 pb-4">
        {#each pagedLogs as group (group.id)}
          <div
            class="border-border bg-card overflow-hidden rounded-lg border"
            data-log-id={group.id}
          >
            <!-- Request -->
            {#if group.request}
              <div class="bg-muted/30">
                <div class="border-border flex items-center justify-between border-b px-4 py-2">
                  <div class="flex items-center gap-2">
                    <ArrowUpCircle class="size-4 text-blue-400" />
                    <span class="text-sm font-medium text-blue-400">Request</span>
                    <span class="text-muted-foreground text-xs">{group.request.serviceName}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-muted-foreground font-mono text-xs">
                      {formatTimestamp(group.request.timestamp)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-muted-foreground hover:text-foreground size-6"
                      onclick={() => copyToClipboard(group.request!)}
                      title="Copy JSON"
                    >
                      {#if copiedId === group.request.id}
                        <Check class="size-3.5 text-green-400" />
                      {:else}
                        <Copy class="size-3.5" />
                      {/if}
                    </Button>
                  </div>
                </div>
                <pre
                  class="text-muted-foreground bg-primary-foreground/5 max-h-[500px] overflow-x-auto overflow-y-auto p-3 font-mono text-xs whitespace-pre-wrap">{formatJson(
                    group.request,
                  )}</pre>
              </div>
            {/if}

            <!-- Response -->
            {#if group.response}
              <div class="bg-muted/10">
                <div class="border-border flex items-center justify-between border-b px-4 py-2">
                  <div class="flex items-center gap-2">
                    <span class={group.response.error ? 'text-red-400' : 'text-green-400'}>
                      <ArrowDownCircle class="size-4" />
                    </span>
                    <span
                      class={cn(
                        'text-sm font-medium',
                        group.response.error ? 'text-red-400' : 'text-green-400',
                      )}
                    >
                      {group.response.error ? 'Error' : 'Response'}
                    </span>
                    {#if group.response.duration}
                      <span
                        class="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 font-mono text-xs"
                      >
                        {formatDuration(group.response.duration)}
                      </span>
                    {/if}
                    {#if hasJsonText(group.response)}
                      <span
                        class="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 font-mono text-xs"
                        title="A string in this response holds JSON; the readable view expands it"
                      >
                        JSON text
                      </span>
                    {/if}
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-muted-foreground font-mono text-xs">
                      {formatTimestamp(group.response.timestamp)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-muted-foreground hover:text-foreground size-6"
                      onclick={() => copyToClipboard(group.response!)}
                      title="Copy JSON"
                    >
                      {#if copiedId === group.response.id}
                        <Check class="size-3.5 text-green-400" />
                      {:else}
                        <Copy class="size-3.5" />
                      {/if}
                    </Button>
                  </div>
                </div>
                <pre
                  class={cn(
                    'bg-primary-foreground/5 max-h-[500px] overflow-x-auto overflow-y-auto p-3 font-mono text-xs whitespace-pre-wrap',
                    group.response.error ? 'text-red-300' : 'text-muted-foreground',
                  )}>{formatJson(group.response)}</pre>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Scroll to latest button -->
    {#if userScrolledAway}
      <div class="pointer-events-none sticky top-2 flex w-full justify-center">
        <Button
          variant="outline"
          size="sm"
          class="border-border bg-background/80 hover:bg-accent animate-in fade-in slide-in-from-top-2 pointer-events-auto h-8 rounded-full border px-3 shadow-lg backdrop-blur-sm"
          onclick={scrollToTop}
          aria-label="Scroll to latest"
        >
          <ArrowUp class="mr-1.5 size-3.5" />
          <span class="text-xs">Latest</span>
        </Button>
      </div>
    {/if}
  </div>

  <!-- Pagination Controls -->
  <div class="border-border bg-card/50 flex items-center justify-between border-t px-6 py-2">
    <div class="flex items-center gap-4">
      <div class="text-muted-foreground text-xs whitespace-nowrap">
        {#if groupedLogs.length > 0}
          Showing {(currentPage - 1) * pageSize + 1} to {Math.min(
            currentPage * pageSize,
            groupedLogs.length,
          )} of {groupedLogs.length}
        {:else}
          No entries
        {/if}
      </div>

      <div class="flex items-center gap-2">
        <span class="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase"
          >Size</span
        >
        <Select.Root
          type="single"
          value={String(pageSize)}
          onValueChange={(v) => {
            if (v) setPageSize(Number(v))
          }}
        >
          <Select.Trigger class="bg-muted/20 border-border h-7 w-16 text-xs">
            {pageSize}
          </Select.Trigger>
          <Select.Content class="min-w-16">
            <Select.Item value="10" label="10" class="text-xs">10</Select.Item>
            <Select.Item value="20" label="20" class="text-xs">20</Select.Item>
            <Select.Item value="50" label="50" class="text-xs">50</Select.Item>
            <Select.Item value="100" label="100" class="text-xs">100</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        class="h-7 px-2 text-xs"
        disabled={currentPage === 1}
        onclick={() => {
          requestedPage = currentPage - 1
          scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      >
        Previous
      </Button>
      <div class="min-w-[80px] px-2 text-center text-xs font-medium">
        Page {currentPage} of {totalPages}
      </div>
      <Button
        variant="outline"
        size="sm"
        class="h-7 px-2 text-xs"
        disabled={currentPage === totalPages}
        onclick={() => {
          requestedPage = currentPage + 1
          scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      >
        Next
      </Button>
    </div>
  </div>
</div>
