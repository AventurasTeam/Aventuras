<script lang="ts">
  import {
    MapPin,
    Sparkles,
    Loader2,
    AlertCircle,
    Archive,
    BookOpen,
    X,
    ChevronRight,
  } from 'lucide-svelte'
  import * as Card from '$lib/components/ui/card'
  import * as Alert from '$lib/components/ui/alert'
  import * as Collapsible from '$lib/components/ui/collapsible'
  import { Button } from '$lib/components/ui/button'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Label } from '$lib/components/ui/label'
  import { Badge } from '$lib/components/ui/badge'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import UniversalVaultBrowser from '$lib/components/vault/UniversalVaultBrowser.svelte'
  import type { ExpandedSetting } from '$lib/services/ai/sdk'
  import type { EntryType, VaultLorebook } from '$lib/types'
  import type { ImportedLorebookItem } from '../wizardTypes'
  import { getTypeCounts, getTypeColor } from '../wizardTypes'

  interface Props {
    settingSeed: string
    expandedSetting: ExpandedSetting | null
    isExpandingSetting: boolean
    settingError: string | null
    importedLorebooks: ImportedLorebookItem[]
    onSettingSeedChange: (v: string) => void
    onUseAsIs: () => void
    onExpandSetting: () => void
    onSelectLorebookFromVault: (lorebook: VaultLorebook) => void
    onRemoveLorebook: (id: string) => void
    onToggleLorebookExpanded: (id: string) => void
  }

  let {
    settingSeed,
    expandedSetting,
    isExpandingSetting,
    settingError,
    importedLorebooks,
    onSettingSeedChange,
    onUseAsIs,
    onExpandSetting,
    onSelectLorebookFromVault,
    onRemoveLorebook,
    onToggleLorebookExpanded,
  }: Props = $props()

  let showVaultBrowser = $state(false)

  const importedEntries = $derived(importedLorebooks.flatMap((lb) => lb.entries))
  const importedVaultIds = $derived(
    importedLorebooks.map((lb) => lb.vaultId).filter((id): id is string => !!id),
  )
</script>

<div class="space-y-5">
  <p class="text-muted-foreground">Describe or refine the world setting and add lorebooks.</p>

  <!-- Setting Seed -->
  <div class="space-y-2">
    <div class="flex items-center gap-2">
      <MapPin class="h-4 w-4" />
      <Label for="setting-seed">World Setting</Label>
    </div>
    <Textarea
      id="setting-seed"
      placeholder="Describe the world and setting for your story..."
      value={settingSeed}
      oninput={(e) => onSettingSeedChange(e.currentTarget.value)}
      rows={4}
    />
    <div class="flex gap-2">
      <Button variant="secondary" size="sm" onclick={onUseAsIs} disabled={!settingSeed.trim()}>
        Use as-is
      </Button>
      <Button
        variant="default"
        size="sm"
        onclick={onExpandSetting}
        disabled={!settingSeed.trim() || isExpandingSetting}
      >
        {#if isExpandingSetting}
          <Loader2 class="mr-1 h-3 w-3 animate-spin" />
          Expanding...
        {:else}
          <Sparkles class="mr-1 h-3 w-3" />
          Expand with AI
        {/if}
      </Button>
    </div>
  </div>

  {#if settingError}
    <Alert.Root variant="destructive">
      <AlertCircle class="h-4 w-4" />
      <Alert.Description>{settingError}</Alert.Description>
    </Alert.Root>
  {/if}

  <!-- Expanded Setting Preview -->
  {#if expandedSetting}
    <Card.Root class="border-primary/20 bg-primary/5">
      <Card.Content class="p-4">
        <h5 class="mb-1 text-sm font-medium">{expandedSetting.name}</h5>
        <p class="text-muted-foreground text-sm">{expandedSetting.description}</p>
        {#if expandedSetting.themes.length > 0}
          <div class="mt-2 flex flex-wrap gap-1">
            {#each expandedSetting.themes as theme (theme)}
              <Badge variant="outline" class="text-xs">{theme}</Badge>
            {/each}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- Lorebooks Section -->
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h4 class="flex items-center gap-2 text-sm font-medium">
        <BookOpen class="h-4 w-4" />
        Lorebooks
        {#if importedLorebooks.length > 0}
          <Badge variant="secondary" class="text-xs">
            {importedEntries.length} entries
          </Badge>
        {/if}
      </h4>
      <Button variant="outline" size="sm" onclick={() => (showVaultBrowser = !showVaultBrowser)}>
        <Archive class="mr-1 h-3 w-3" />
        {showVaultBrowser ? 'Hide Vault' : 'Add from Vault'}
      </Button>
    </div>

    {#if showVaultBrowser}
      <Card.Root>
        <Card.Content class="p-3">
          <UniversalVaultBrowser
            type="lorebook"
            onSelect={(item) => {
              onSelectLorebookFromVault(item as VaultLorebook)
              showVaultBrowser = false
            }}
            disabledIds={importedVaultIds}
          />
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- Imported Lorebooks List -->
    {#if importedLorebooks.length > 0}
      <ScrollArea class="max-h-[200px]">
        <div class="space-y-2 pr-2">
          {#each importedLorebooks as lorebook (lorebook.id)}
            <Collapsible.Root
              open={lorebook.expanded}
              onOpenChange={() => onToggleLorebookExpanded(lorebook.id)}
            >
              <div class="border-border rounded-lg border">
                <Collapsible.Trigger class="flex w-full items-center justify-between p-3">
                  <div class="flex items-center gap-2">
                    <ChevronRight
                      class="text-muted-foreground h-4 w-4 transition-transform {lorebook.expanded
                        ? 'rotate-90'
                        : ''}"
                    />
                    <span class="text-sm font-medium">{lorebook.filename}</span>
                    <Badge variant="outline" class="text-xs">
                      {lorebook.entries.length} entries
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onclick={(e) => {
                      e.stopPropagation()
                      onRemoveLorebook(lorebook.id)
                    }}
                  >
                    <X class="h-3 w-3" />
                  </Button>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <div class="border-t p-3">
                    <div class="flex flex-wrap gap-2">
                      {#each Object.entries(getTypeCounts(lorebook.entries)) as [type, count] (type)}
                        {#if count > 0}
                          <Badge
                            variant="secondary"
                            class="text-xs {getTypeColor(type as EntryType)}"
                          >
                            {type}: {count}
                          </Badge>
                        {/if}
                      {/each}
                    </div>
                  </div>
                </Collapsible.Content>
              </div>
            </Collapsible.Root>
          {/each}
        </div>
      </ScrollArea>
    {/if}
  </div>
</div>
