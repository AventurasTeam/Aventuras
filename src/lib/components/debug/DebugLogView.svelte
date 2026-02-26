<script lang="ts">
  import { type DebugLogEntry } from '$lib/stores/ui.svelte'
  import {
    ArrowUpCircle,
    ArrowDownCircle,
    Copy,
    Check,
    Filter,
    CirclePlus,
    Trash2,
    WrapText,
  } from 'lucide-svelte'
  import { Button } from '$lib/components/ui/button'
  import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates'
  import * as Select from '$lib/components/ui/select'
  import { Badge } from '$lib/components/ui/badge'
  import { Separator } from '$lib/components/ui/separator'
  import { Autocomplete } from '$lib/components/ui/autocomplete'
  import { cn } from '$lib/utils/cn.js'
  import { SvelteMap } from 'svelte/reactivity'

  interface Props {
    logs: DebugLogEntry[]
    onClear?: () => void
    renderNewlines: boolean
    onToggleRenderNewlines?: () => void
  }

  let { logs, onClear, renderNewlines, onToggleRenderNewlines }: Props = $props()

  let copiedId = $state<string | null>(null)
  let selectedCategories = $state<string[]>([])
  let scrollContainer: HTMLDivElement | null = $state(null)
  let savedScrollTop = 0
  let savedScrollHeight = 0

  // Pagination
  let currentPage = $state(1)
  let pageSize = $state(20)

  $effect(() => {
    // Reset to page 1 when filters change, logs are cleared, or page size changes
    void selectedCategories
    void logs
    void pageSize
    currentPage = 1
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

  const jsonCache = new SvelteMap<string, string>()

  const MAX_DISPLAY_CHARS = 200_000

  function formatJson(entry: DebugLogEntry): string {
    const cacheKey = `${entry.id}-${renderNewlines}`
    const cached = jsonCache.get(cacheKey)
    if (cached) return cached

    try {
      let json = JSON.stringify(entry.data, null, 2)
      if (renderNewlines) {
        json = json.replace(/\\n/g, '\n')
      }
      if (json.length > MAX_DISPLAY_CHARS) {
        json =
          json.slice(0, MAX_DISPLAY_CHARS) +
          `\n\n... [truncated — ${json.length.toLocaleString()} total chars] ...`
      }
      if (jsonCache.size > 200) {
        const firstKey = jsonCache.keys().next().value
        if (firstKey) jsonCache.delete(firstKey)
      }
      jsonCache.set(cacheKey, json)
      return json
    } catch {
      return String(entry.data)
    }
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
    return Array.from(all).sort()
  })

  let groupedLogs = $derived.by(() => {
    let currentLogs = logs

    if (selectedCategories.length > 0) {
      currentLogs = currentLogs.filter((l) => selectedCategories.includes(l.serviceName))
    }

    const groups: { request?: DebugLogEntry; response?: DebugLogEntry }[] = []
    const requestMap = new SvelteMap<string, number>()

    for (const log of currentLogs) {
      if (log.type === 'request') {
        groups.push({ request: log })
        requestMap.set(log.id, groups.length - 1)
      } else {
        const requestId = log.id.replace('-response', '')
        const groupIndex = requestMap.get(requestId)
        if (groupIndex !== undefined) {
          groups[groupIndex].response = log
        } else {
          groups.push({ response: log })
        }
      }
    }

    return groups.reverse()
  })

  let totalPages = $derived(Math.ceil(groupedLogs.length / pageSize) || 1)

  let pagedLogs = $derived.by(() => {
    const start = (currentPage - 1) * pageSize
    return groupedLogs.slice(start, start + pageSize)
  })

  // Scroll management
  $effect.pre(() => {
    void groupedLogs
    if (scrollContainer) {
      savedScrollTop = scrollContainer.scrollTop
      savedScrollHeight = scrollContainer.scrollHeight
    }
  })

  $effect(() => {
    void groupedLogs
    if (scrollContainer && savedScrollHeight > 0) {
      const heightDiff = scrollContainer.scrollHeight - savedScrollHeight
      scrollContainer.scrollTop = savedScrollTop + heightDiff
    }
  })
</script>

<div class="bg-background flex h-full flex-col overflow-hidden">
  <!-- Toolbar -->
  <div class="border-border bg-card/50 flex items-center justify-between border-b px-6 py-3">
    <div class="flex items-center gap-2">
      <Filter class="text-muted-foreground h-3.5 w-3.5" />
      <Autocomplete
        items={categories}
        selected={selectedCategories}
        onSelect={(val) => {
          selectedCategories = val as string[]
        }}
        multiple
        placeholder="Services"
        class="bg-muted/20 h-8 w-48 shrink-0 border-dashed"
        itemLabel={(c) => c}
        itemValue={(c) => c}
      >
        {#snippet triggerSnippet()}
          <div class="flex items-center gap-2">
            <CirclePlus class="h-4 w-4 opacity-50" />
            <span class="text-xs">Services</span>
          </div>
        {/snippet}
        {#snippet itemSnippet(cat)}
          {@const isSelected = selectedCategories.includes(cat)}
          <div
            class={cn(
              'border-primary mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
              isSelected ? 'bg-primary text-primary-foreground' : 'opacity-50 [&_svg]:invisible',
            )}
          >
            <Check class="h-4 w-4" />
          </div>
          <span class="truncate text-xs">{cat}</span>
        {/snippet}
      </Autocomplete>

      {#if selectedCategories.length > 0}
        <Separator orientation="vertical" class="mx-1 h-4" />
        <div class="flex flex-wrap items-center gap-1.5">
          {#each selectedCategories as cat (cat)}
            <Badge
              variant="secondary"
              class="hover:bg-secondary/80 flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-normal transition-colors"
              onclick={() => {
                selectedCategories = selectedCategories.filter((c) => c !== cat)
              }}
            >
              {cat}
              <Trash2 class="h-3 w-3 opacity-50 hover:opacity-100" />
            </Badge>
          {/each}
          <Button
            variant="ghost"
            size="sm"
            class="text-muted-foreground h-6 px-1.5 text-[10px] font-medium transition-colors hover:text-red-400"
            onclick={() => (selectedCategories = [])}
          >
            Clear all
          </Button>
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if onToggleRenderNewlines}
        <Button
          variant="ghost"
          size="icon"
          class={renderNewlines
            ? 'text-blue-400 hover:text-blue-500'
            : 'text-muted-foreground hover:text-foreground'}
          onclick={onToggleRenderNewlines}
          title={renderNewlines ? 'Show escaped newlines (\\n)' : 'Render newlines as line breaks'}
        >
          <WrapText class="h-4 w-4" />
        </Button>
      {/if}

      {#if onClear}
        <Button
          variant="ghost"
          size="icon"
          class="text-muted-foreground h-8 w-8 hover:bg-red-900/10 hover:text-red-400"
          onclick={onClear}
          title="Clear all logs"
        >
          <Trash2 class="h-4 w-4" />
        </Button>
      {/if}
    </div>
  </div>

  <!-- Logs Area -->
  <div class="flex-1 overflow-y-auto px-6 py-4" bind:this={scrollContainer}>
    {#if pagedLogs.length === 0}
      <div class="text-muted-foreground flex h-48 flex-col items-center justify-center text-sm">
        <p>No API requests matching the current filter.</p>
      </div>
    {:else}
      <div class="space-y-4 pb-4">
        {#each pagedLogs as group, i (`${group.request?.id ?? group.response?.id ?? i}-${i}`)}
          <div class="border-border bg-card overflow-hidden rounded-lg border">
            <!-- Request -->
            {#if group.request}
              <div class="bg-muted/30">
                <div class="border-border flex items-center justify-between border-b px-4 py-2">
                  <div class="flex items-center gap-2">
                    <ArrowUpCircle class="h-4 w-4 text-blue-400" />
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
                      class="text-muted-foreground hover:text-foreground h-6 w-6"
                      onclick={() => copyToClipboard(group.request!)}
                      title="Copy JSON"
                    >
                      {#if copiedId === group.request.id}
                        <Check class="h-3.5 w-3.5 text-green-400" />
                      {:else}
                        <Copy class="h-3.5 w-3.5" />
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
                      <ArrowDownCircle class="h-4 w-4" />
                    </span>
                    <span
                      class="text-sm font-medium {group.response.error
                        ? 'text-red-400'
                        : 'text-green-400'}"
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
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-muted-foreground font-mono text-xs">
                      {formatTimestamp(group.response.timestamp)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-muted-foreground hover:text-foreground h-6 w-6"
                      onclick={() => copyToClipboard(group.response!)}
                      title="Copy JSON"
                    >
                      {#if copiedId === group.response.id}
                        <Check class="h-3.5 w-3.5 text-green-400" />
                      {:else}
                        <Copy class="h-3.5 w-3.5" />
                      {/if}
                    </Button>
                  </div>
                </div>
                <pre
                  class="bg-primary-foreground/5 max-h-[500px] overflow-x-auto overflow-y-auto p-3 font-mono text-xs whitespace-pre-wrap"
                  class:text-muted-foreground={!group.response.error}
                  class:text-red-300={group.response.error}>{formatJson(group.response)}</pre>
              </div>
            {/if}
          </div>
        {/each}
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
            if (v) pageSize = Number(v)
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
          currentPage--
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
          currentPage++
          scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      >
        Next
      </Button>
    </div>
  </div>
</div>
