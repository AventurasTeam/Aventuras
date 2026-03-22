<script lang="ts">
  import {
    User,
    Users,
    MapPin,
    BookOpen,
    MessageSquare,
    FileText,
    Loader2,
    AlertCircle,
    Save,
  } from 'lucide-svelte'
  import * as Card from '$lib/components/ui/card'
  import * as Alert from '$lib/components/ui/alert'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Badge } from '$lib/components/ui/badge'
  import { Switch } from '$lib/components/ui/switch'
  import type { GeneratedProtagonist, GeneratedCharacter } from '$lib/services/ai/sdk'
  import type { ImportedLorebookItem } from '../wizardTypes'
  import type { StoryMode, POV } from '$lib/types'
  import type { Tense } from '$lib/services/ai/wizard'

  interface Props {
    storyTitle: string
    selectedMode: StoryMode
    selectedPOV: POV
    selectedTense: Tense
    tone: string
    protagonist: GeneratedProtagonist | null
    protagonistPortrait: string | null
    supportingCharacters: GeneratedCharacter[]
    settingSeed: string
    importedLorebooks: ImportedLorebookItem[]
    importChatAsEntries: boolean
    chatMessageCount: number
    isCreatingStory: boolean
    createError: string | null
    saveToVault: boolean
    hasCard: boolean
    vaultTag: string
    vaultDescription: string
    onTitleChange: (v: string) => void
    onSaveToVaultChange: (v: boolean) => void
    onVaultTagChange: (v: string) => void
    onVaultDescriptionChange: (v: string) => void
  }

  let {
    storyTitle,
    selectedMode,
    selectedPOV,
    selectedTense,
    tone,
    protagonist,
    protagonistPortrait,
    supportingCharacters,
    settingSeed,
    importedLorebooks,
    importChatAsEntries,
    chatMessageCount,
    isCreatingStory,
    createError,
    saveToVault,
    hasCard,
    vaultTag,
    vaultDescription,
    onTitleChange,
    onSaveToVaultChange,
    onVaultTagChange,
    onVaultDescriptionChange,
  }: Props = $props()

  const totalLorebookEntries = $derived(importedLorebooks.flatMap((lb) => lb.entries).length)
</script>

<div class="space-y-5">
  <p class="text-muted-foreground">Review your import and give your story a title.</p>

  <!-- Story Title -->
  <div class="space-y-2">
    <Label for="story-title">Story Title</Label>
    <Input
      id="story-title"
      placeholder="Enter a title for your story"
      value={storyTitle}
      oninput={(e) => onTitleChange(e.currentTarget.value)}
    />
  </div>

  <!-- Tag & Description -->
  <div class="space-y-2">
    <Label for="vault-tag">Tag</Label>
    <Input
      id="vault-tag"
      placeholder="e.g. fantasy, sci-fi, romance"
      value={vaultTag}
      oninput={(e) => onVaultTagChange(e.currentTarget.value)}
    />
  </div>
  <div class="space-y-2">
    <Label for="vault-description">Description</Label>
    <Input
      id="vault-description"
      placeholder="Enter Description for your story"
      value={vaultDescription}
      oninput={(e) => onVaultDescriptionChange(e.currentTarget.value)}
    />
  </div>

  <!-- Summary Cards -->
  <div class="space-y-3">
    <!-- Mode & Style -->
    <Card.Root>
      <Card.Content class="p-3">
        <div class="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {selectedMode === 'adventure' ? 'Adventure' : 'Creative Writing'}
          </Badge>
          <Badge variant="outline">{selectedPOV} person</Badge>
          <Badge variant="outline">{selectedTense} tense</Badge>
          {#if tone}
            <Badge variant="outline">{tone}</Badge>
          {/if}
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Protagonist -->
    {#if protagonist}
      <Card.Root>
        <Card.Content class="flex items-center gap-3 p-3">
          {#if protagonistPortrait}
            <img
              src={protagonistPortrait}
              alt={protagonist.name}
              class="h-10 w-10 rounded-lg object-cover"
            />
          {/if}
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <User class="text-primary h-4 w-4" />
              <p class="text-sm font-medium">{protagonist.name}</p>
            </div>
            <p class="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
              {protagonist.description}
            </p>
          </div>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- Supporting Cast -->
    {#if supportingCharacters.length > 0}
      <Card.Root>
        <Card.Content class="p-3">
          <div class="flex items-center gap-2">
            <Users class="text-muted-foreground h-4 w-4" />
            <span class="text-sm">{supportingCharacters.length} supporting characters</span>
          </div>
          <div class="mt-1.5 flex flex-wrap gap-1">
            {#each supportingCharacters as char (char.name)}
              <Badge variant="outline" class="text-xs">{char.name}</Badge>
            {/each}
          </div>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- Setting -->
    {#if settingSeed}
      <Card.Root>
        <Card.Content class="p-3">
          <div class="flex items-center gap-2">
            <MapPin class="text-muted-foreground h-4 w-4" />
            <span class="text-sm font-medium">World Setting</span>
          </div>
          <p class="text-muted-foreground mt-1 line-clamp-2 text-xs">{settingSeed}</p>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- Lorebook -->
    {#if totalLorebookEntries > 0}
      <Card.Root>
        <Card.Content class="flex items-center gap-2 p-3">
          <BookOpen class="text-muted-foreground h-4 w-4" />
          <span class="text-sm">
            {totalLorebookEntries} lorebook entries from {importedLorebooks.length} lorebook{importedLorebooks.length >
            1
              ? 's'
              : ''}
          </span>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- Chat Import -->
    <Card.Root>
      <Card.Content class="flex items-center gap-2 p-3">
        {#if importChatAsEntries}
          <MessageSquare class="text-muted-foreground h-4 w-4" />
          <span class="text-sm">{chatMessageCount} chat messages will be imported</span>
        {:else}
          <FileText class="text-muted-foreground h-4 w-4" />
          <span class="text-sm">Starting fresh with card opening</span>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Save to Vault Option -->
    {#if hasCard}
      <Card.Root>
        <Card.Content class="flex items-center justify-between p-3">
          <div class="flex items-center gap-2">
            <Save class="text-muted-foreground h-4 w-4" />
            <span class="text-sm">Save scenario to vault</span>
          </div>
          <Switch checked={saveToVault} onCheckedChange={(v) => onSaveToVaultChange(v)} />
        </Card.Content>
      </Card.Root>
    {/if}
  </div>

  <!-- Loading -->
  {#if isCreatingStory}
    <div class="flex items-center gap-2 text-sm">
      <Loader2 class="text-primary h-4 w-4 animate-spin" />
      Creating your story...
    </div>
  {/if}

  {#if createError}
    <Alert.Root variant="destructive">
      <AlertCircle class="h-4 w-4" />
      <Alert.Description>{createError}</Alert.Description>
    </Alert.Root>
  {/if}
</div>
