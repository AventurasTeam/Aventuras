<script lang="ts">
  import { Users, Map, BookOpen, Loader2, AlertCircle, Check, RefreshCw } from 'lucide-svelte'
  import * as Card from '$lib/components/ui/card'
  import * as Alert from '$lib/components/ui/alert'
  import { Switch } from '$lib/components/ui/switch'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import type { ParsedCard, CardImportResult } from '$lib/services/characterCardImporter'

  interface Props {
    cardParsedData: ParsedCard | null
    cardPortrait: string | null
    sanitizedDescription: string | null
    hasEmbeddedLorebook: boolean
    embeddedLorebookEntryCount: number
    importCharacters: boolean
    importScenario: boolean
    importLorebook: boolean
    isProcessingCard: boolean
    cardImportResult: CardImportResult | null
    cardProcessError: string | null
    onImportCharactersChange: (v: boolean) => void
    onImportScenarioChange: (v: boolean) => void
    onImportLorebookChange: (v: boolean) => void
    onProcessCard: () => void
  }

  let {
    cardParsedData,
    cardPortrait,
    sanitizedDescription,
    hasEmbeddedLorebook,
    embeddedLorebookEntryCount,
    importCharacters,
    importScenario,
    importLorebook,
    isProcessingCard,
    cardImportResult,
    cardProcessError,
    onImportCharactersChange,
    onImportScenarioChange,
    onImportLorebookChange,
    onProcessCard,
  }: Props = $props()

  // Auto-trigger processing when entering this step with a card and no result yet
  $effect(() => {
    if (cardParsedData && !cardImportResult && !isProcessingCard && !cardProcessError) {
      onProcessCard()
    }
  })
</script>

<div class="space-y-5">
  <div class="flex items-center justify-between">
    <p class="text-muted-foreground">
      Choose what to import from <strong>{cardParsedData?.name}</strong> and review the extracted data.
    </p>
    {#if !isProcessingCard}
      <Button variant="outline" size="sm" class="shrink-0 gap-1.5" onclick={onProcessCard}>
        <RefreshCw class="h-3 w-3" />
        Reprocess
      </Button>
    {/if}
  </div>

  {#if isProcessingCard}
    <Card.Root>
      <Card.Content class="flex items-center gap-3 p-6">
        <Loader2 class="text-primary h-5 w-5 animate-spin" />
        <div>
          <p class="text-sm font-medium">Processing character card...</p>
          <p class="text-muted-foreground text-xs">
            Using AI to extract characters, setting, and scenario data.
          </p>
        </div>
      </Card.Content>
    </Card.Root>
  {:else}
    <!-- Import Toggles with Previews -->
    <div class="space-y-3">
      <!-- Characters -->
      <Card.Root
        class="transition-colors {importCharacters
          ? 'border-primary/30 bg-primary/5'
          : 'opacity-60'}"
      >
        <Card.Content class="p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex h-8 w-8 items-center justify-center rounded-lg {importCharacters
                  ? 'bg-primary/20'
                  : 'bg-muted'}"
              >
                <Users
                  class="h-4 w-4 {importCharacters ? 'text-primary' : 'text-muted-foreground'}"
                />
              </div>
              <div>
                <p class="text-sm font-medium">Characters (as Supporting Cast)</p>
                <p class="text-muted-foreground text-xs">
                  {#if cardImportResult}
                    {cardImportResult.primaryCharacterName}
                    {#if cardImportResult.npcs.length > 0}
                      + {cardImportResult.npcs.length} extracted NPCs
                    {/if}
                  {:else}
                    Card character and extracted NPCs
                  {/if}
                </p>
              </div>
            </div>
            <Switch
              checked={importCharacters}
              onCheckedChange={(v) => onImportCharactersChange(v)}
            />
          </div>

          <!-- Character Preview -->
          {#if importCharacters && cardImportResult}
            <div class="border-border mt-3 space-y-2 border-t pt-3">
              <!-- Primary card character -->
              <div class="flex items-center gap-3">
                {#if cardPortrait}
                  <img
                    src={cardPortrait}
                    alt={cardImportResult.primaryCharacterName}
                    class="h-10 w-10 rounded-lg object-cover"
                  />
                {:else}
                  <div class="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
                    <Users class="text-muted-foreground h-4 w-4" />
                  </div>
                {/if}
                <div>
                  <p class="text-sm font-medium">{cardImportResult.primaryCharacterName}</p>
                  <p class="text-muted-foreground text-xs">
                    {sanitizedDescription
                      ? sanitizedDescription.slice(0, 100) +
                        (sanitizedDescription.length > 100 ? '...' : '')
                      : 'Primary card character'}
                  </p>
                </div>
              </div>
              <!-- Extracted NPCs -->
              {#if cardImportResult.npcs.length > 0}
                <div class="text-muted-foreground ml-13 text-xs">
                  <span class="font-medium">Extracted NPCs:</span>
                  <ul class="mt-1 ml-4 list-disc space-y-0.5">
                    {#each cardImportResult.npcs as npc (npc.name)}
                      <li>{npc.name}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}
        </Card.Content>
      </Card.Root>

      <!-- Scenario -->
      <Card.Root
        class="transition-colors {importScenario ? 'border-primary/30 bg-primary/5' : 'opacity-60'}"
      >
        <Card.Content class="p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex h-8 w-8 items-center justify-center rounded-lg {importScenario
                  ? 'bg-primary/20'
                  : 'bg-muted'}"
              >
                <Map class="h-4 w-4 {importScenario ? 'text-primary' : 'text-muted-foreground'}" />
              </div>
              <div>
                <p class="text-sm font-medium">Scenario & Setting</p>
                <p class="text-muted-foreground text-xs">World setting and scenario description</p>
              </div>
            </div>
            <Switch checked={importScenario} onCheckedChange={(v) => onImportScenarioChange(v)} />
          </div>

          <!-- Scenario Preview -->
          {#if importScenario && cardImportResult?.settingSeed}
            <div class="border-border mt-3 border-t pt-3">
              <p class="text-muted-foreground text-xs">
                {cardImportResult.settingSeed.slice(0, 200)}{cardImportResult.settingSeed.length >
                200
                  ? '...'
                  : ''}
              </p>
            </div>
          {/if}
        </Card.Content>
      </Card.Root>

      <!-- Lorebook -->
      <Card.Root
        class="transition-colors {importLorebook && hasEmbeddedLorebook
          ? 'border-primary/30 bg-primary/5'
          : 'opacity-60'}"
      >
        <Card.Content class="p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex h-8 w-8 items-center justify-center rounded-lg {importLorebook &&
                hasEmbeddedLorebook
                  ? 'bg-primary/20'
                  : 'bg-muted'}"
              >
                <BookOpen
                  class="h-4 w-4 {importLorebook && hasEmbeddedLorebook
                    ? 'text-primary'
                    : 'text-muted-foreground'}"
                />
              </div>
              <div>
                <p class="text-sm font-medium">
                  Embedded Lorebook
                  {#if !hasEmbeddedLorebook}
                    <Badge variant="outline" class="ml-1 text-xs">Not available</Badge>
                  {/if}
                </p>
                <p class="text-muted-foreground text-xs">
                  {#if hasEmbeddedLorebook}
                    {embeddedLorebookEntryCount} lore {embeddedLorebookEntryCount === 1
                      ? 'entry'
                      : 'entries'} embedded in character book
                  {:else}
                    This card doesn't contain an embedded lorebook
                  {/if}
                </p>
              </div>
            </div>
            <Switch
              checked={importLorebook && hasEmbeddedLorebook}
              disabled={!hasEmbeddedLorebook}
              onCheckedChange={(v) => onImportLorebookChange(v)}
            />
          </div>
        </Card.Content>
      </Card.Root>
    </div>

    {#if cardImportResult}
      <div class="flex items-center gap-2 text-sm text-green-400">
        <Check class="h-4 w-4" />
        Card processed successfully — details shown above.
      </div>
    {/if}
  {/if}

  {#if cardProcessError}
    <Alert.Root variant="destructive">
      <AlertCircle class="h-4 w-4" />
      <Alert.Description>{cardProcessError}</Alert.Description>
    </Alert.Root>
  {/if}
</div>
