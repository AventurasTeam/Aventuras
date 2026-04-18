<script lang="ts">
  import { slide } from 'svelte/transition'
  import {
    Archive,
    Loader2,
    Check,
    Sparkles,
    X,
    PenTool,
    Users,
    Plus,
    Trash2,
    ChevronDown,
    User,
  } from 'lucide-svelte'
  import UniversalVaultBrowser from '$lib/components/vault/UniversalVaultBrowser.svelte'
  import { characterVault } from '$lib/stores/characterVault.svelte'
  import type { GeneratedCharacter, GeneratedProtagonist } from '$lib/services/ai/sdk'
  import type { VaultCharacter } from '$lib/types'

  // Shadcn Components
  import * as Card from '$lib/components/ui/card'
  import * as Collapsible from '$lib/components/ui/collapsible'
  import * as Avatar from '$lib/components/ui/avatar'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Separator } from '$lib/components/ui/separator'
  import { Badge } from '$lib/components/ui/badge'

  interface Props {
    protagonist: GeneratedProtagonist | null
    supportingCharacters: GeneratedCharacter[]

    // Supporting character form
    showSupportingCharacterForm: boolean
    editingSupportingCharacterIndex: number | null
    supportingCharacterName: string
    supportingCharacterRole: string
    supportingCharacterDescription: string
    supportingCharacterRelationship: string
    supportingCharacterTraits: string
    supportingCharacterGuidance: string

    // Loading states
    isGeneratingCharacters: boolean
    isElaboratingSupportingCharacter: boolean

    // Form handlers
    onSupportingNameChange: (value: string) => void
    onSupportingRoleChange: (value: string) => void
    onSupportingDescriptionChange: (value: string) => void
    onSupportingRelationshipChange: (value: string) => void
    onSupportingTraitsChange: (value: string) => void
    onSupportingGuidanceChange: (value: string) => void

    // Action handlers
    onOpenSupportingForm: () => void
    onEditSupportingCharacter: (index: number) => void
    onCancelSupportingForm: () => void
    onUseSupportingAsIs: () => void
    onElaborateSupportingCharacter: () => void
    onDeleteSupportingCharacter: (index: number) => void
    onGenerateCharacters: () => void

    // Vault handlers
    onSelectSupportingFromVault: (character: VaultCharacter) => void
    onNavigateToVault?: () => void
  }

  let {
    protagonist,
    supportingCharacters,
    showSupportingCharacterForm,
    editingSupportingCharacterIndex,
    supportingCharacterName,
    supportingCharacterRole,
    supportingCharacterDescription,
    supportingCharacterRelationship,
    supportingCharacterTraits,
    supportingCharacterGuidance,
    isGeneratingCharacters,
    isElaboratingSupportingCharacter,
    onSupportingNameChange,
    onSupportingRoleChange,
    onSupportingDescriptionChange,
    onSupportingRelationshipChange,
    onSupportingTraitsChange,
    onSupportingGuidanceChange,
    onOpenSupportingForm,
    onEditSupportingCharacter,
    onCancelSupportingForm,
    onUseSupportingAsIs,
    onElaborateSupportingCharacter,
    onDeleteSupportingCharacter,
    onGenerateCharacters,
    onSelectSupportingFromVault,
    onNavigateToVault,
  }: Props = $props()

  // Local state
  let showAdjustWithAI = $state(false)
  let showVaultPicker = $state(false)
  let loadedVaultCharacterId = $state<string | null>(null)

  const hasVaultCharacters = $derived(
    characterVault.isLoaded && characterVault.characters.length > 0,
  )

  const addedVaultCharacterIds = $derived(
    supportingCharacters.map((c) => c.vaultId).filter((id): id is string => !!id),
  )

  function handleSelectFromVault(character: VaultCharacter) {
    loadedVaultCharacterId = character.id
    onSelectSupportingFromVault(character)
    // Don't close immediately so user can add multiple if they want,
    // though the disabled logic handles preventing duplicates.
    // Actually, maybe close it to indicate success? User preference.
    // Let's keep it open for multi-select feel or close it?
    // The previous implementation for cards closed it. Let's close it.
    showVaultPicker = false
  }
</script>

<div class="space-y-4">
  <!-- Header / Description -->
  <div class="space-y-1">
    <h3 class="text-lg font-medium">Supporting Cast</h3>
    <p class="text-muted-foreground text-sm">
      Add side characters, allies, or antagonists to enrich your story. This step is optional.
    </p>
  </div>

  <!-- Load from Vault Section -->
  <div class="space-y-1">
    <div class="flex items-center justify-between pb-1">
      <h4 class="text-muted-foreground flex items-center gap-2 text-sm font-medium">
        <Archive class="h-4 w-4" />
        Load from Vault
      </h4>
      <Button
        variant="link"
        size="sm"
        class="h-auto p-0 text-xs"
        onclick={() => onNavigateToVault?.()}
      >
        Manage Vault
      </Button>
    </div>

    <div
      class="border-muted-foreground/20 bg-muted/10 text-card-foreground rounded-lg border shadow-sm"
    >
      <Collapsible.Root open={showVaultPicker} onOpenChange={(open) => (showVaultPicker = open)}>
        <div class="flex items-center gap-3 p-3 pl-4">
          <Collapsible.Trigger
            class="group/trigger flex w-full flex-1 items-center justify-between gap-2 text-left"
          >
            <div class="flex items-center gap-3">
              <div
                class="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-md transition-colors"
              >
                <Users class="text-primary h-4 w-4" />
              </div>
              <div class="text-left">
                <div class="text-sm font-medium">
                  {supportingCharacters.length > 0
                    ? `${supportingCharacters.length} Character${supportingCharacters.length === 1 ? '' : 's'} Added`
                    : 'Add from Vault'}
                </div>
                <div class="text-muted-foreground text-xs">
                  {hasVaultCharacters ? 'Browse your saved characters' : 'Vault is empty'}
                </div>
              </div>
            </div>
            <div
              class="bg-muted/50 group-hover/trigger:bg-muted flex h-8 w-8 items-center justify-center rounded-md transition-colors"
            >
              <ChevronDown
                class="h-4 w-4 transition-transform duration-200 group-data-[state=open]/trigger:rotate-180"
              />
            </div>
          </Collapsible.Trigger>
        </div>

        <Collapsible.Content>
          <div class="h-80 border-t p-3">
            <UniversalVaultBrowser
              type="character"
              onSelect={handleSelectFromVault}
              selectedId={loadedVaultCharacterId}
              disabledIds={addedVaultCharacterIds}
              {onNavigateToVault}
            />
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  </div>

  <Separator />

  <!-- Add New / Generate Section -->
  {#if !showSupportingCharacterForm}
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2" transition:slide>
      <Button
        variant="outline"
        class="hover:border-primary/50 h-12 justify-start gap-3 border-dashed hover:border-solid"
        onclick={onOpenSupportingForm}
      >
        <div class="bg-primary/10 flex h-6 w-6 items-center justify-center rounded-full">
          <Plus class="text-primary h-4 w-4" />
        </div>
        <span class="text-sm">Create New Character</span>
      </Button>

      <Button
        variant="outline"
        class="hover:border-primary/50 h-12 justify-start gap-3 border-dashed hover:border-solid"
        onclick={onGenerateCharacters}
        disabled={isGeneratingCharacters || !protagonist}
        title={!protagonist ? 'Create a protagonist first' : 'Generate 3 AI characters'}
      >
        <div class="bg-accent/10 flex h-6 w-6 items-center justify-center rounded-full">
          {#if isGeneratingCharacters}
            <Loader2 class="text-accent-foreground h-4 w-4 animate-spin" />
          {:else}
            <Sparkles class="text-accent-foreground h-4 w-4" />
          {/if}
        </div>
        <span class="text-sm">Generate Cast with AI</span>
      </Button>
    </div>
  {:else}
    <!-- Creation Form -->
    <div class="bg-card text-card-foreground rounded-lg border p-3 shadow-sm" transition:slide>
      <div class="mb-2 flex items-center justify-between">
        <h4 class="flex items-center gap-2 text-sm font-medium">
          <User class="h-4 w-4" />
          {editingSupportingCharacterIndex !== null ? 'Edit Character' : 'New Character'}
        </h4>
        <Button variant="ghost" size="icon" class="h-8 w-8" onclick={onCancelSupportingForm}>
          <X class="h-4 w-4" />
        </Button>
      </div>

      <div class="space-y-2.5">
        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Input
            label="Name"
            id="supp-name"
            value={supportingCharacterName}
            oninput={(e) => onSupportingNameChange(e.currentTarget.value)}
            placeholder="e.g., Lady Vivienne"
          />
          <Input
            label="Role"
            id="supp-role"
            value={supportingCharacterRole}
            oninput={(e) => onSupportingRoleChange(e.currentTarget.value)}
            placeholder="e.g., ally, antagonist..."
          />
        </div>

        <div class="space-y-1.5">
          <Label for="supp-desc" class="text-xs">Description</Label>
          <Textarea
            id="supp-desc"
            value={supportingCharacterDescription}
            oninput={(e) => onSupportingDescriptionChange(e.currentTarget.value)}
            placeholder="Appearance, personality..."
            class="min-h-20 resize-none text-sm"
          />
        </div>

        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Input
            label="Relationship"
            id="supp-rel"
            value={supportingCharacterRelationship}
            oninput={(e) => onSupportingRelationshipChange(e.currentTarget.value)}
            placeholder="e.g., Childhood friend..."
          />
          <Input
            label="Traits"
            id="supp-traits"
            value={supportingCharacterTraits}
            oninput={(e) => onSupportingTraitsChange(e.currentTarget.value)}
            placeholder="e.g., cunning, loyal..."
          />
        </div>

        <!-- AI Adjustments -->
        <Collapsible.Root
          open={showAdjustWithAI}
          onOpenChange={(open) => (showAdjustWithAI = open)}
          class="space-y-2"
        >
          <div class="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              class="text-muted-foreground hover:text-foreground h-8 gap-2 px-0 text-xs hover:bg-transparent"
              onclick={() => (showAdjustWithAI = !showAdjustWithAI)}
            >
              <Sparkles class="h-3.5 w-3.5" />
              {showAdjustWithAI ? 'Hide AI Options' : 'Adjust with AI'}
              <ChevronDown
                class="h-3 w-3 transition-transform {showAdjustWithAI ? 'rotate-180' : ''}"
              />
            </Button>
          </div>

          <Collapsible.Content class="-mt-3 space-y-2">
            <div class="space-y-1.5">
              <Label
                for="ai-guidance-supp"
                class="text-muted-foreground text-[10px] tracking-wider uppercase">Guidance</Label
              >
              <Textarea
                id="ai-guidance-supp"
                value={supportingCharacterGuidance}
                oninput={(e) => onSupportingGuidanceChange(e.currentTarget.value)}
                placeholder="e.g., Make them more sinister..."
                class="h-16 resize-none text-xs"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              class="w-full gap-2"
              onclick={onElaborateSupportingCharacter}
              disabled={isElaboratingSupportingCharacter || !supportingCharacterName.trim()}
            >
              {#if isElaboratingSupportingCharacter}
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
                Expanding...
              {:else}
                <Sparkles class="h-3.5 w-3.5" />
                Expand Details
              {/if}
            </Button>
          </Collapsible.Content>
        </Collapsible.Root>

        <Separator class="my-2" />

        <div class="flex justify-end gap-2">
          <Button variant="ghost" onclick={onCancelSupportingForm}>Cancel</Button>
          <Button
            class="gap-2"
            onclick={onUseSupportingAsIs}
            disabled={!supportingCharacterName.trim()}
          >
            <Check class="h-4 w-4" />
            {editingSupportingCharacterIndex !== null ? 'Update' : 'Add Character'}
          </Button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Character List -->
  {#if supportingCharacters.length > 0}
    <div class="grid grid-cols-1 gap-3 pt-2">
      <h4 class="text-muted-foreground mb-1 text-sm font-medium">
        Cast Members ({supportingCharacters.length})
      </h4>
      {#each supportingCharacters as char, index (index)}
        <Card.Root class="group hover:border-primary/30 transition-all">
          <Card.Content class="flex items-start gap-2.5 p-2.5">
            <Avatar.Root class="mt-0.5 h-8 w-8 border">
              <!-- If we had a portrait for generated chars, we'd use it here.
                     For now, fallback. -->
              <Avatar.Fallback class="bg-primary/10 text-primary">
                <User class="h-4 w-4" />
              </Avatar.Fallback>
            </Avatar.Root>

            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 overflow-hidden">
                  <span class="truncate text-sm font-medium">{char.name}</span>
                  {#if char.role}
                    <Badge variant="secondary" class="h-4 px-1 text-[10px] font-normal">
                      {char.role}
                    </Badge>
                  {/if}
                </div>

                <div
                  class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    class="text-muted-foreground hover:text-foreground h-6 w-6"
                    onclick={() => onEditSupportingCharacter(index)}
                    title="Edit"
                  >
                    <PenTool class="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="text-muted-foreground hover:text-destructive h-6 w-6"
                    onclick={() => onDeleteSupportingCharacter(index)}
                    title="Delete"
                  >
                    <Trash2 class="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <p class="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
                {char.description}
              </p>

              {#if char.relationship}
                <p class="text-muted-foreground/70 mt-0.5 text-[10px] italic">
                  {char.relationship}
                </p>
              {/if}
            </div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {/if}
</div>
