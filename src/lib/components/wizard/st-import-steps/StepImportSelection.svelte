<script lang="ts">
  import { Users, Map, BookOpen, Loader2, AlertCircle, Check } from 'lucide-svelte'
  import * as Card from '$lib/components/ui/card'
  import * as Alert from '$lib/components/ui/alert'
  import { Switch } from '$lib/components/ui/switch'
  import { Label } from '$lib/components/ui/label'
  import { Badge } from '$lib/components/ui/badge'
  import type { ParsedCard, CardImportResult } from '$lib/services/characterCardImporter'

  interface Props {
    cardParsedData: ParsedCard | null
    hasEmbeddedLorebook: boolean
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
    hasEmbeddedLorebook,
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
  {#if !cardParsedData}
    <div class="text-muted-foreground flex flex-col items-center py-8 text-center">
      <p class="text-sm">No character card was uploaded.</p>
      <p class="mt-1 text-xs">You can go back to add one, or continue to set up manually.</p>
    </div>
  {:else}
    <p class="text-muted-foreground">
      Choose what to import from <strong>{cardParsedData.name}</strong>.
    </p>

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
      <!-- Import Toggles -->
      <div class="space-y-3">
        <!-- Characters -->
        <Card.Root
          class="transition-colors {importCharacters
            ? 'border-primary/30 bg-primary/5'
            : 'opacity-60'}"
        >
          <Card.Content class="flex items-center justify-between p-4">
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
                <p class="text-sm font-medium">Characters</p>
                <p class="text-muted-foreground text-xs">
                  {#if cardImportResult}
                    {cardImportResult.primaryCharacterName}
                    {#if cardImportResult.npcs.length > 0}
                      + {cardImportResult.npcs.length} NPCs
                    {/if}
                  {:else}
                    Primary character and extracted NPCs
                  {/if}
                </p>
              </div>
            </div>
            <Switch
              checked={importCharacters}
              onCheckedChange={(v) => onImportCharactersChange(v)}
            />
          </Card.Content>
        </Card.Root>

        <!-- Scenario -->
        <Card.Root
          class="transition-colors {importScenario
            ? 'border-primary/30 bg-primary/5'
            : 'opacity-60'}"
        >
          <Card.Content class="flex items-center justify-between p-4">
            <div class="flex items-center gap-3">
              <div
                class="flex h-8 w-8 items-center justify-center rounded-lg {importScenario
                  ? 'bg-primary/20'
                  : 'bg-muted'}"
              >
                <Map
                  class="h-4 w-4 {importScenario ? 'text-primary' : 'text-muted-foreground'}"
                />
              </div>
              <div>
                <p class="text-sm font-medium">Scenario & Setting</p>
                <p class="text-muted-foreground text-xs">
                  {#if cardImportResult?.settingSeed}
                    {cardImportResult.settingSeed.slice(0, 80)}{cardImportResult.settingSeed.length >
                    80
                      ? '...'
                      : ''}
                  {:else}
                    World setting and scenario description
                  {/if}
                </p>
              </div>
            </div>
            <Switch checked={importScenario} onCheckedChange={(v) => onImportScenarioChange(v)} />
          </Card.Content>
        </Card.Root>

        <!-- Lorebook -->
        <Card.Root
          class="transition-colors {importLorebook && hasEmbeddedLorebook
            ? 'border-primary/30 bg-primary/5'
            : 'opacity-60'}"
        >
          <Card.Content class="flex items-center justify-between p-4">
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
                    Character book with world lore entries
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
          </Card.Content>
        </Card.Root>
      </div>

      {#if cardImportResult}
        <div class="flex items-center gap-2 text-sm text-green-400">
          <Check class="h-4 w-4" />
          Card processed successfully
        </div>
      {/if}
    {/if}

    {#if cardProcessError}
      <Alert.Root variant="destructive">
        <AlertCircle class="h-4 w-4" />
        <Alert.Description>{cardProcessError}</Alert.Description>
      </Alert.Root>
    {/if}
  {/if}
</div>
