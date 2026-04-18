<script lang="ts">
  import { Archive, Loader2, FileJson, ChevronRight, AlertCircle, X, BookOpen } from 'lucide-svelte'
  import UniversalVaultBrowser from '$lib/components/vault/UniversalVaultBrowser.svelte'
  import type { EntryType, VaultLorebook } from '$lib/types'
  import type { ImportedLorebookItem } from '../wizardTypes'
  import { getTypeCounts, getTypeColor } from '../wizardTypes'

  import * as Card from '$lib/components/ui/card'
  import * as Alert from '$lib/components/ui/alert'
  import * as Collapsible from '$lib/components/ui/collapsible'
  import { Button, buttonVariants } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import { Progress } from '$lib/components/ui/progress'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { cn } from '$lib/utils/cn'

  interface Props {
    importedLorebooks: ImportedLorebookItem[]
    importError: string | null
    onSelectFromVault: (lorebook: VaultLorebook) => void
    onRemoveLorebook: (id: string) => void
    onToggleExpanded: (id: string) => void
    onClearAll: () => void
    onNavigateToVault: () => void
  }

  let {
    importedLorebooks,
    importError,
    onSelectFromVault,
    onRemoveLorebook,
    onToggleExpanded,
    onClearAll,
    onNavigateToVault,
  }: Props = $props()

  // Get list of vault lorebook IDs that have been imported
  const importedVaultLorebookIds = $derived(
    importedLorebooks.map((lb) => lb.vaultId).filter((id): id is string => !!id),
  )

  // Combined summary for display
  const importedEntries = $derived(importedLorebooks.flatMap((lb) => lb.entries))

  const importSummary = $derived.by(() => {
    if (importedLorebooks.length === 0) return null
    const entries = importedEntries
    return {
      total: entries.length,
      withContent: entries.filter((e) => e.description?.trim()).length,
      byType: getTypeCounts(entries),
    }
  })
</script>

<!-- Header Section -->
<div class="mb-4 space-y-1">
  <div class="flex items-center gap-2">
    <div class="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-md">
      <Archive class="text-primary h-4 w-4" />
    </div>
    <h3 class="text-lg font-medium">Vault Lorebooks</h3>
  </div>
  <p class="text-muted-foreground text-sm">
    Select lorebooks from your vault to populate your world with characters, locations, and lore.
  </p>
</div>

<!-- Vault Browser -->
<div class="space-y-1">
  <div class="flex items-center justify-between pb-1">
    <h4 class="text-muted-foreground flex items-center gap-2 text-sm font-medium">
      <BookOpen class="h-4 w-4" />
      Available in Vault
    </h4>
    <Button variant="link" size="sm" class="h-auto p-0 text-xs" onclick={onNavigateToVault}>
      Manage Vault
    </Button>
  </div>

  <UniversalVaultBrowser
    type="lorebook"
    onSelect={onSelectFromVault}
    {onNavigateToVault}
    disabledIds={importedVaultLorebookIds}
  />
</div>

{#if importError}
  <Alert.Root variant="destructive">
    <AlertCircle class="h-4 w-4" />
    <Alert.Title>Error</Alert.Title>
    <Alert.Description>{importError}</Alert.Description>
  </Alert.Root>
{/if}

<!-- Selected Lorebooks List -->
{#if importedLorebooks.length > 0}
  <div class="relative py-4">
    <div class="absolute inset-0 flex items-center" aria-hidden="true">
      <div class="w-full border-t"></div>
    </div>
    <div class="relative flex justify-center text-xs uppercase">
      <span class="bg-background text-muted-foreground px-2">Selected Items</span>
    </div>
  </div>

  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-foreground text-sm font-medium">
        Imported Lorebooks ({importedLorebooks.length})
      </h3>
      {#if importedLorebooks.length > 1}
        <Button
          variant="ghost"
          size="sm"
          onclick={onClearAll}
          class="text-muted-foreground hover:text-destructive h-8"
        >
          Clear All
        </Button>
      {/if}
    </div>

    <div class="grid gap-3">
      {#each importedLorebooks as lorebook (lorebook.id)}
        <Collapsible.Root
          open={lorebook.expanded}
          onOpenChange={() => onToggleExpanded(lorebook.id)}
          class="group"
        >
          <Card.Root
            class={cn(
              'border-muted-foreground/20 bg-muted/10 overflow-hidden transition-all',
              lorebook.isLoading && 'animate-pulse',
            )}
          >
            <!-- Main Row -->
            <div class="flex items-center gap-3 p-2">
              <!-- Expand Toggle -->
              <Collapsible.Trigger
                class={cn(
                  buttonVariants({ variant: 'ghost', size: 'icon' }),
                  'text-muted-foreground hover:text-foreground h-8 w-8 shrink-0 p-0',
                )}
                disabled={lorebook.isLoading}
              >
                <ChevronRight
                  class={cn(
                    'h-4 w-4 transition-transform duration-200',
                    lorebook.expanded && 'rotate-90',
                  )}
                />
              </Collapsible.Trigger>

              <!-- Icon -->
              <div class="bg-secondary shrink-0 rounded-md p-2">
                {#if lorebook.isLoading}
                  <Loader2 class="text-primary h-4 w-4 animate-spin" />
                {:else}
                  <FileJson class="text-primary h-4 w-4" />
                {/if}
              </div>

              <!-- Info -->
              <div class="grid min-w-0 flex-1 gap-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium">
                    {lorebook.filename.replace(' (from Vault)', '')}
                  </span>
                  {#if lorebook.result.warnings.length > 0 && !lorebook.isLoading}
                    <Badge
                      variant="outline"
                      class="h-5 border-amber-500/50 px-1 py-0 text-[10px] text-amber-600 dark:text-amber-500"
                    >
                      {lorebook.result.warnings.length} Warnings
                    </Badge>
                  {/if}
                </div>

                {#if lorebook.isLoading}
                  <div class="space-y-1.5">
                    <p class="text-muted-foreground flex justify-between text-xs">
                      <span>{lorebook.loadingMessage || 'Processing...'}</span>
                      {#if lorebook.classificationProgress}
                        <span
                          >{Math.round(
                            (lorebook.classificationProgress.current /
                              lorebook.classificationProgress.total) *
                              100,
                          )}%</span
                        >
                      {/if}
                    </p>
                    {#if lorebook.classificationProgress}
                      <Progress
                        value={(lorebook.classificationProgress.current /
                          lorebook.classificationProgress.total) *
                          100}
                        class="h-1.5"
                      />
                    {/if}
                  </div>
                {:else}
                  <div class="text-muted-foreground flex items-center gap-2 text-xs">
                    <span>{lorebook.entries.length} entries</span>
                    {#if !lorebook.expanded}
                      <span class="text-muted-foreground/30">•</span>
                      <span class="truncate opacity-70">
                        {Object.entries(getTypeCounts(lorebook.entries))
                          .filter(([, c]) => c > 0)
                          .map(([t, c]) => `${c} ${t}`)
                          .join(', ')}
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>

              <!-- Remove Action -->
              {#if !lorebook.isLoading}
                <Button
                  variant="ghost"
                  size="icon"
                  class="text-muted-foreground hover:text-destructive h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
                  onclick={() => onRemoveLorebook(lorebook.id)}
                  title="Remove"
                >
                  <X class="h-4 w-4" />
                </Button>
              {/if}
            </div>

            <!-- Expanded Details -->
            <Collapsible.Content>
              <div class="bg-muted/30 border-t p-3">
                <!-- Stats Grid -->
                <div class="flex flex-wrap gap-2">
                  {#each Object.entries(getTypeCounts(lorebook.entries)) as [type, count] (type)}
                    {#if count > 0}
                      <Badge variant="outline" class="bg-background/50 gap-2 px-2.5 font-normal">
                        <span class={cn('shrink-0', getTypeColor(type as EntryType))}>●</span>
                        <span class="truncate capitalize">{type}</span>
                        <span class="text-muted-foreground font-mono opacity-75">{count}</span>
                      </Badge>
                    {/if}
                  {/each}
                </div>

                <div class="flex items-center justify-between pt-2 pb-1">
                  <h4 class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    Preview
                  </h4>
                </div>

                <ScrollArea class="bg-background h-45 w-full rounded-md border">
                  <div class="space-y-1 p-2">
                    {#each lorebook.entries.slice(0, 10) as entry (entry.name)}
                      <div
                        class="hover:bg-muted/50 flex items-center gap-2 rounded-sm p-2 text-sm transition-colors"
                      >
                        <Badge
                          variant="outline"
                          class="bg-muted/20 h-5 shrink-0 px-1.5 text-[10px] font-normal"
                        >
                          <span class={getTypeColor(entry.type)}>{entry.type}</span>
                        </Badge>
                        <span class="flex-1 truncate text-xs font-medium sm:text-sm">
                          {entry.name}
                        </span>
                        {#if entry.keywords.length > 0}
                          <span class="text-muted-foreground max-w-100 truncate text-[10px]">
                            {entry.keywords.slice(0, 3).join(', ')}
                          </span>
                        {/if}
                      </div>
                    {/each}
                    {#if lorebook.entries.length > 10}
                      <div class="text-muted-foreground bg-muted/20 py-2 text-center text-xs">
                        + {lorebook.entries.length - 10} more entries
                      </div>
                    {/if}
                  </div>
                </ScrollArea>

                {#if lorebook.result.warnings.length > 0}
                  <Alert.Root variant="destructive" class="py-2">
                    <AlertCircle class="h-4 w-4" />
                    <Alert.Description class="text-xs">
                      {lorebook.result.warnings.length} warning(s) occurred during import.
                      <ul class="mt-1 list-inside list-disc">
                        {#each lorebook.result.warnings.slice(0, 3) as warning (warning)}
                          <li>{warning}</li>
                        {/each}
                      </ul>
                    </Alert.Description>
                  </Alert.Root>
                {/if}
              </div>
            </Collapsible.Content>
          </Card.Root>
        </Collapsible.Root>
      {/each}
    </div>

    <!-- Summary Card -->
    {#if importedLorebooks.length > 1 && importSummary}
      <Card.Root class="bg-primary/5 border-primary/10 shadow-none">
        <Card.Content
          class="flex flex-col items-start justify-between gap-4 p-4 sm:flex-row sm:items-center"
        >
          <div>
            <p class="text-foreground font-medium">Total Imported Content</p>
            <p class="text-muted-foreground text-xs">
              {importSummary.total} entries across {importedLorebooks.length} lorebooks
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            {#each Object.entries(importSummary.byType) as [type, count] (type)}
              {#if count > 0}
                <Badge variant="secondary" class="bg-background/80">
                  {type}: {count}
                </Badge>
              {/if}
            {/each}
          </div>
        </Card.Content>
      </Card.Root>
    {/if}
  </div>
{/if}
