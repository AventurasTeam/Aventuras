<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { characterVault } from '$lib/stores/characterVault.svelte'
  import {
    Plus,
    User,
    Skull,
    UserX,
    Pencil,
    Star,
    ImageUp,
    Wand2,
    X,
    Loader2,
    ChevronDown,
    Archive,
    UserPlus,
    Save,
  } from 'lucide-svelte'
  import type { Character } from '$lib/types'
  import type { RuntimeVariable, RuntimeVarsMap } from '$lib/services/packs/types'
  import {
    hasRequiredCredentials,
    getProviderDisplayName,
    generatePortrait as sdkGeneratePortrait,
  } from '$lib/services/ai/image'
  import { database } from '$lib/services/database'
  import RuntimeVariableDisplay from './RuntimeVariableDisplay.svelte'
  import { ContextBuilder } from '$lib/services/context'
  import { normalizeImageDataUrl } from '$lib/utils/image'
  import { createLogger } from '$lib/services/ai/core/config'

  const log = createLogger('CharacterPortrait')
  import { Button, buttonVariants } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Badge } from '$lib/components/ui/badge'
  import * as Avatar from '$lib/components/ui/avatar'
  import * as ToggleGroup from '$lib/components/ui/toggle-group'
  import { Label } from '$lib/components/ui/label'
  import { cn } from '$lib/utils/cn'
  import IconRow from '$lib/components/ui/icon-row.svelte'
  import { DEFAULT_FALLBACK_STYLE_PROMPT } from '$lib/services/ai/image/constants'

  let showAddForm = $state(false)
  let newName = $state('')
  let newDescription = $state('')
  let newRelationship = $state('')
  let editingId = $state<string | null>(null)
  let editName = $state('')
  let editDescription = $state('')
  let editRelationship = $state('')
  let editStatus = $state<Character['status']>('active')
  let editTraits = $state('')
  let editVisualDescriptors = $state('')
  let pendingProtagonistId = $state<string | null>(null)
  let previousRelationshipLabel = $state('')
  let swapError = $state<string | null>(null)

  // Portrait state
  let uploadingPortraitId = $state<string | null>(null)
  let generatingPortraitId = $state<string | null>(null)
  let portraitError = $state<string | null>(null)
  let editPortrait = $state<string | null>(null)
  let expandedPortrait = $state<{ src: string; name: string } | null>(null)
  let savedToVaultId = $state<string | null>(null)
  let expandedDescriptors = $state<Set<string>>(new Set())

  // Runtime variables
  let runtimeVarDefs = $state<RuntimeVariable[]>([])
  let editRuntimeVars = $state<RuntimeVarsMap>({})

  $effect(() => {
    if (story.currentStory) {
      loadRuntimeVarDefs()
    }
  })

  async function loadRuntimeVarDefs() {
    if (!story.currentStory) return
    try {
      const packId = await database.getStoryPackId(story.currentStory.id)
      if (packId) {
        runtimeVarDefs = await database.getRuntimeVariablesByEntityType(packId, 'character')
      } else {
        runtimeVarDefs = []
      }
    } catch {
      runtimeVarDefs = []
    }
  }

  function updateEditRuntimeVar(
    defId: string,
    variableName: string,
    value: string | number | null,
  ) {
    editRuntimeVars = {
      ...editRuntimeVars,
      [defId]: { variableName, v: value },
    }
  }

  function toggleDescriptorExpand(characterId: string) {
    const newSet = new SvelteSet(expandedDescriptors)
    if (newSet.has(characterId)) {
      newSet.delete(characterId)
    } else {
      newSet.add(characterId)
    }
    expandedDescriptors = newSet
  }

  const currentProtagonistName = $derived.by(
    () => story.characters.find((c) => c.relationship === 'self')?.name ?? 'current',
  )

  import type { VisualDescriptors } from '$lib/types'
  import {
    descriptorsToString,
    stringToDescriptors,
    hasDescriptors as hasVisualDescriptors,
  } from '$lib/utils/visualDescriptors'
  import { SvelteSet } from 'svelte/reactivity'

  // Color palette for descriptor categories
  const CATEGORY_COLORS: Record<keyof VisualDescriptors, string> = {
    face: 'text-amber-600 dark:text-amber-400',
    hair: 'text-purple-600 dark:text-purple-400',
    eyes: 'text-sky-600 dark:text-sky-400',
    build: 'text-emerald-600 dark:text-emerald-400',
    clothing: 'text-rose-600 dark:text-rose-400',
    accessories: 'text-orange-600 dark:text-orange-400',
    distinguishing: 'text-teal-600 dark:text-teal-400',
  }

  // Labels for descriptor categories (displayed in UI)
  const CATEGORY_LABELS: Record<keyof VisualDescriptors, string> = {
    face: 'Face',
    hair: 'Hair',
    eyes: 'Eyes',
    build: 'Build',
    clothing: 'Clothing',
    accessories: 'Accessories',
    distinguishing: 'Distinguishing',
  }

  interface CategorizedDescriptor {
    key: keyof VisualDescriptors
    label: string
    color: string
    value: string
  }

  // Convert visual descriptors object to display format
  function getVisualDescriptorsList(descriptors: VisualDescriptors): CategorizedDescriptor[] {
    const order: (keyof VisualDescriptors)[] = [
      'face',
      'hair',
      'eyes',
      'build',
      'clothing',
      'accessories',
      'distinguishing',
    ]

    return order
      .filter((key) => descriptors[key])
      .map((key) => ({
        key,
        label: CATEGORY_LABELS[key],
        color: CATEGORY_COLORS[key],
        value: descriptors[key]!,
      }))
  }

  async function addCharacter() {
    if (!newName.trim()) return
    await story.addCharacter(
      newName.trim(),
      newDescription.trim() || undefined,
      newRelationship.trim() || undefined,
    )
    newName = ''
    newDescription = ''
    newRelationship = ''
    showAddForm = false
  }

  async function saveCharacterToVault(character: Character) {
    if (!story.currentStory) return

    // Ensure vault is loaded
    if (!characterVault.isLoaded) {
      await characterVault.load()
    }

    await characterVault.saveFromStory(character, story.currentStory.id)

    savedToVaultId = character.id
    setTimeout(() => (savedToVaultId = null), 2000)
  }

  function startEdit(character: Character) {
    editingId = character.id
    editName = character.name
    editDescription = character.description ?? ''
    editRelationship = character.relationship ?? ''
    editStatus = character.status
    editTraits = character.traits.join(', ')
    editVisualDescriptors = descriptorsToString(character.visualDescriptors)
    editPortrait = character.portrait
    portraitError = null
    // Initialize runtime vars from entity metadata
    const rv = (character.metadata as Record<string, unknown> | null)?.runtimeVars
    editRuntimeVars = rv && typeof rv === 'object' ? { ...(rv as RuntimeVarsMap) } : {}
  }

  function cancelEdit() {
    editingId = null
    editName = ''
    editDescription = ''
    editRelationship = ''
    editTraits = ''
    editVisualDescriptors = ''
    editStatus = 'active'
    editPortrait = null
    portraitError = null
    editRuntimeVars = {}
  }

  async function saveEdit(character: Character) {
    const name = editName.trim()
    if (!name) return

    const relationship = editRelationship.trim()
    const traits = editTraits
      .split(',')
      .map((trait) => trait.trim())
      .filter(Boolean)
    const visualDescriptors = stringToDescriptors(editVisualDescriptors)

    // Merge runtime vars into metadata
    const existingMeta = (character.metadata as Record<string, unknown>) ?? {}
    const hasRuntimeVarEdits = Object.keys(editRuntimeVars).length > 0
    const updatedMetadata = hasRuntimeVarEdits
      ? {
          ...existingMeta,
          runtimeVars: {
            ...((existingMeta.runtimeVars as RuntimeVarsMap) ?? {}),
            ...editRuntimeVars,
          },
        }
      : character.metadata

    await story.updateCharacter(character.id, {
      name,
      description: editDescription.trim() || null,
      relationship: character.relationship === 'self' ? 'self' : relationship || null,
      status: editStatus,
      traits,
      visualDescriptors,
      portrait: editPortrait,
      metadata: updatedMetadata,
    })

    cancelEdit()
  }

  async function deleteCharacter(character: Character) {
    await story.deleteCharacter(character.id)
  }

  function beginSwap(character: Character) {
    pendingProtagonistId = character.id
    previousRelationshipLabel = ''
    swapError = null
  }

  function cancelSwap() {
    pendingProtagonistId = null
    previousRelationshipLabel = ''
    swapError = null
  }

  async function confirmSwap(character: Character) {
    swapError = null
    try {
      const label = previousRelationshipLabel.trim()
      if (!label || label.toLowerCase() === 'self') {
        swapError = 'Enter a custom label for the previous protagonist.'
        return
      }
      await story.setProtagonist(character.id, label)
      cancelSwap()
    } catch (error) {
      swapError = error instanceof Error ? error.message : 'Failed to swap protagonists.'
    }
  }

  type LucideIcon = typeof User

  const STATUS_CONFIG: Record<
    Character['status'],
    { icon: LucideIcon; color: string; bgColor: string }
  > = {
    active: {
      icon: User,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10 ring-green-500/50',
    },
    inactive: {
      icon: UserX,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted ring-muted-foreground/30',
    },
    deceased: {
      icon: Skull,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10 ring-destructive/50',
    },
  }

  function getStatusConfig(status: Character['status']) {
    return STATUS_CONFIG[status] ?? STATUS_CONFIG.active
  }

  // Portrait handling functions
  async function handlePortraitUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || !editingId) return

    uploadingPortraitId = editingId
    portraitError = null

    try {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        throw new Error('Please select an image file')
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Image must be smaller than 5MB')
      }

      // Convert to base64
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result
          if (typeof result !== 'string' || !result.startsWith('data:image/')) {
            reject(new Error('Failed to read image data'))
            return
          }
          resolve(result)
        }
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })

      editPortrait = dataUrl
    } catch (error) {
      portraitError = error instanceof Error ? error.message : 'Failed to upload portrait'
    } finally {
      uploadingPortraitId = null
      // Reset input
      input.value = ''
    }
  }

  async function generatePortrait(character: Character) {
    const imageSettings = settings.systemServicesSettings.imageGeneration

    log('Starting portrait generation', {
      characterName: character.name,
      model: settings.getImageProfile(imageSettings.portraitProfileId ?? '')?.model ?? '',
      styleId: imageSettings.portraitStyleId,
    })

    // Validate credentials
    if (!hasRequiredCredentials()) {
      const providerName = getProviderDisplayName()
      log('Missing credentials for provider', { provider: providerName })
      portraitError = `${providerName} API key required for portrait generation`
      return
    }

    // Get visual descriptors from current edit state or character
    const descriptors = editVisualDescriptors
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)

    if (descriptors.length === 0) {
      log('No visual descriptors provided')
      portraitError = 'Add appearance descriptors first'
      return
    }

    generatingPortraitId = character.id
    portraitError = null

    try {
      // Get the style prompt from database (external template)
      const styleId = imageSettings.portraitStyleId

      let stylePrompt = ''
      try {
        const template = await database.getPackTemplate('default-pack', styleId)
        stylePrompt = template?.content || ''
      } catch {
        stylePrompt = DEFAULT_FALLBACK_STYLE_PROMPT
      }

      // Build the portrait generation prompt using ContextBuilder
      const ctx = new ContextBuilder()
      ctx.add({
        mode: 'adventure',
        pov: 'second',
        tense: 'present',
        protagonistName: '',
        imageStylePrompt: stylePrompt,
        visualDescriptors: descriptors.join(', '),
        characterName: editName || character.name,
      })
      const { system: portraitPrompt } = await ctx.render('image-portrait-generation')

      log('Sending portrait generation request', {
        promptLength: portraitPrompt.length,
        descriptorCount: descriptors.length,
      })

      // Generate the portrait using SDK
      const base64 = await sdkGeneratePortrait(portraitPrompt)

      log('Portrait generated successfully', {
        characterName: character.name,
      })

      editPortrait = `data:image/png;base64,${base64}`
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate portrait'
      log('Portrait generation failed', {
        characterName: character.name,
        error: errorMessage,
      })
      portraitError = errorMessage
    } finally {
      generatingPortraitId = null
    }
  }

  function removePortrait() {
    editPortrait = null
    portraitError = null
  }

  function toggleCollapse(characterId: string) {
    const isCollapsed = ui.isEntityCollapsed(characterId)
    ui.toggleEntityCollapsed(characterId, !isCollapsed)
  }

  function hasDetails(character: Character): boolean {
    return (
      character.traits.length > 0 ||
      hasVisualDescriptors(character.visualDescriptors) ||
      !!character.description
    )
  }
</script>

<div class="flex flex-col gap-1 pb-12">
  <!-- Header -->
  <div class="mb-2 flex items-center justify-between">
    <h3 class="text-foreground text-xl font-bold tracking-tight">Characters</h3>
    <Button
      variant="text"
      size="icon"
      class="text-muted-foreground hover:text-foreground h-6 w-6"
      onclick={() => (showAddForm = !showAddForm)}
      title="Add character"
    >
      <Plus class="h-6! w-6!" />
    </Button>
  </div>

  <!-- Add Form -->
  {#if showAddForm}
    <div class="border-border bg-card rounded-lg border p-3 shadow-sm">
      <div class="space-y-3">
        <Input type="text" bind:value={newName} placeholder="Name" class="h-8 text-sm" />
        <Input
          type="text"
          bind:value={newRelationship}
          placeholder="Relationship (ally, enemy...)"
          class="h-8 text-sm"
        />
        <Textarea
          bind:value={newDescription}
          placeholder="Description (optional)"
          class="min-h-15 resize-none text-sm"
          rows={2}
        />
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <Button variant="text" size="sm" class="h-7" onclick={() => (showAddForm = false)}>
          Cancel
        </Button>
        <Button size="sm" class="h-7" onclick={addCharacter} disabled={!newName.trim()}>Add</Button>
      </div>
    </div>
  {/if}

  <!-- Empty State -->
  {#if story.characters.length === 0}
    <div
      class="border-border bg-muted/20 flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center"
    >
      <div class="bg-muted mb-3 rounded-full p-3">
        <UserPlus class="text-muted-foreground h-6 w-6" />
      </div>
      <p class="text-muted-foreground text-sm">No characters yet</p>
      <Button
        variant="link"
        class="text-primary mt-1 h-auto p-0 text-xs"
        onclick={() => (showAddForm = true)}
      >
        <Plus class="mr-1.5 h-3.5 w-3.5" />
        Add your first character
      </Button>
    </div>
  {:else}
    <!-- Character List -->
    <div class="flex flex-col gap-2">
      {#each story.characters as character (character.id)}
        {@const statusConfig = getStatusConfig(character.status)}
        {@const isProtagonist = character.relationship === 'self'}
        {@const isCollapsed = ui.isEntityCollapsed(character.id)}
        {@const isEditing = editingId === character.id}

        <div
          class={cn(
            'group bg-card rounded-lg border px-2.5 py-2 shadow-sm transition-all',
            isEditing && 'ring-primary/20 border-border ring-1',
            !isEditing && character.status === 'active' && 'border-green-500/30',
            !isEditing && character.status === 'inactive' && 'border-muted-foreground/20',
            !isEditing && character.status === 'deceased' && 'border-destructive/30',
          )}
        >
          {#if isEditing}
            <!-- EDIT MODE -->
            <div class="space-y-3">
              <div class="mb-2 flex items-center justify-between">
                <h4 class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Editing {character.name}
                </h4>
                <Button variant="text" size="icon" class="h-6 w-6" onclick={cancelEdit}
                  ><X class="h-4 w-4" /></Button
                >
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="col-span-2 space-y-1 sm:col-span-1">
                  <Label class="text-xs">Name</Label>
                  <Input type="text" bind:value={editName} placeholder="Name" class="h-8 text-sm" />
                </div>
                <div class="col-span-2 space-y-1 sm:col-span-1">
                  <Label class="text-xs">Relationship</Label>
                  <Input
                    type="text"
                    bind:value={editRelationship}
                    placeholder={isProtagonist ? 'Protagonist' : 'Relationship'}
                    class="h-8 text-sm"
                    disabled={isProtagonist}
                  />
                </div>
              </div>

              <div class="space-y-1">
                <Label class="text-xs">Status</Label>
                <ToggleGroup.Root
                  type="single"
                  value={editStatus}
                  onValueChange={(v) => {
                    if (v) editStatus = v as Character['status']
                  }}
                  class="w-full justify-start gap-1 rounded-md border p-1"
                >
                  <ToggleGroup.Item
                    value="active"
                    class="h-7 flex-1 text-xs data-[state=on]:bg-green-500/10 data-[state=on]:text-green-600"
                  >
                    <!-- <User class="h-3 w-3" /> -->
                    Active
                  </ToggleGroup.Item>
                  <ToggleGroup.Item
                    value="inactive"
                    class="data-[state=on]:bg-muted data-[state=on]:text-foreground h-7 flex-1 text-xs"
                  >
                    <!-- <UserX class="h-3 w-3" /> -->
                    Inactive
                  </ToggleGroup.Item>
                  <ToggleGroup.Item
                    value="deceased"
                    class="data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive h-7 flex-1 text-xs"
                  >
                    <!-- <Skull class="h-3 w-3" /> -->
                    Deceased
                  </ToggleGroup.Item>
                </ToggleGroup.Root>
              </div>

              <div class="space-y-1">
                <Label class="text-xs">Traits & Appearance</Label>
                <Input
                  type="text"
                  bind:value={editTraits}
                  placeholder="Traits (comma separated)"
                  class="mb-2 h-8 text-xs"
                />
                <Input
                  type="text"
                  bind:value={editVisualDescriptors}
                  placeholder="Appearance (comma separated)"
                  class="h-8 text-xs"
                />
              </div>

              <div class="space-y-1">
                <Label class="text-xs">Description</Label>
                <Textarea
                  bind:value={editDescription}
                  placeholder="Description"
                  class="min-h-[60px] resize-none text-xs"
                />
              </div>

              <!-- Runtime Variables (Edit) -->
              {#if runtimeVarDefs.length > 0}
                <RuntimeVariableDisplay
                  definitions={runtimeVarDefs}
                  values={editRuntimeVars}
                  editMode={true}
                  onValueChange={(defId, value) => {
                    const def = runtimeVarDefs.find((d) => d.id === defId)
                    if (def) updateEditRuntimeVar(defId, def.variableName, value)
                  }}
                />
              {/if}

              <!-- Portrait Section -->
              <div class="border-border bg-muted/20 rounded-md border p-2">
                <div
                  class="text-muted-foreground mb-2 flex items-center justify-between text-xs font-medium"
                >
                  <span>Portrait</span>
                  {#if editPortrait}
                    <Button
                      variant="destructive"
                      size="sm"
                      class="h-5 px-1.5 text-xs"
                      onclick={removePortrait}
                    >
                      Remove
                    </Button>
                  {/if}
                </div>
                <div class="flex items-start gap-3">
                  {#if editPortrait}
                    <img
                      src={normalizeImageDataUrl(editPortrait) ?? ''}
                      alt="Portrait preview"
                      class="ring-border bg-background h-16 w-16 rounded-md object-cover ring-1"
                    />
                  {:else}
                    <div
                      class="border-border bg-background/50 flex h-16 w-16 items-center justify-center rounded-md border border-dashed"
                    >
                      <User class="text-muted-foreground h-6 w-6" />
                    </div>
                  {/if}
                  <div class="flex flex-1 flex-col gap-2">
                    <label
                      class={cn(
                        buttonVariants({ variant: 'outline', size: 'sm' }),
                        'bg-background h-7 w-full cursor-pointer justify-start text-xs',
                      )}
                    >
                      {#if uploadingPortraitId === character.id}
                        <Loader2 class="h-3.5 w-3.5 animate-spin" />
                        <span>Uploading...</span>
                      {:else}
                        <ImageUp class="h-3.5 w-3.5" />
                        <span>Upload</span>
                      {/if}
                      <input
                        type="file"
                        accept="image/*"
                        class="hidden"
                        onchange={handlePortraitUpload}
                        disabled={uploadingPortraitId !== null || generatingPortraitId !== null}
                      />
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      class="bg-background h-7 w-full justify-start text-xs"
                      onclick={() => generatePortrait(character)}
                      disabled={generatingPortraitId !== null ||
                        uploadingPortraitId !== null ||
                        !editVisualDescriptors.trim()}
                      title={!editVisualDescriptors.trim()
                        ? 'Add appearance first'
                        : 'Generate from appearance'}
                    >
                      {#if generatingPortraitId === character.id}
                        <Loader2 class="h-3.5 w-3.5 animate-spin" />
                        <span>Generating...</span>
                      {:else}
                        <Wand2 class="h-3.5 w-3.5" />
                        <span>Generate</span>
                      {/if}
                    </Button>
                  </div>
                </div>
                {#if portraitError}
                  <p class="text-destructive mt-2 text-xs">{portraitError}</p>
                {/if}
              </div>

              <div class="border-border flex justify-end gap-2 border-t pt-2">
                <Button variant="text" size="sm" class="h-7 text-xs" onclick={cancelEdit}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  class="h-7 px-4 text-xs"
                  onclick={() => saveEdit(character)}
                  disabled={!editName.trim()}
                >
                  <Save class="mr-1.5 h-3.5 w-3.5" />
                  Save Changes
                </Button>
              </div>
            </div>
          {:else}
            <!-- DISPLAY MODE -->

            <!-- Header: Avatar + Name + Badge -->
            <div class="flex items-start gap-2.5">
              <!-- Avatar with status overlay -->
              {#if character.portrait}
                <button
                  class="relative shrink-0 focus:outline-none"
                  onclick={() =>
                    (expandedPortrait = {
                      src: normalizeImageDataUrl(character.portrait) ?? '',
                      name: character.name,
                    })}
                >
                  <Avatar.Root
                    class={cn(
                      'hover:ring-primary h-8 w-8 ring-2 transition-all',
                      character.status === 'active' && 'ring-green-500/50',
                      character.status === 'inactive' && 'ring-muted-foreground/30',
                      character.status === 'deceased' && 'ring-destructive/50',
                    )}
                  >
                    <Avatar.Image
                      src={normalizeImageDataUrl(character.portrait) ?? ''}
                      alt={character.name}
                      class={cn(
                        'object-cover',
                        character.status === 'inactive' && 'opacity-60 grayscale',
                        character.status === 'deceased' && 'grayscale',
                      )}
                    />
                    <Avatar.Fallback class="bg-muted text-muted-foreground text-[10px]">
                      {character.name.slice(0, 2).toUpperCase()}
                    </Avatar.Fallback>
                  </Avatar.Root>
                  {#if character.status === 'deceased'}
                    <div
                      class="bg-destructive/20 absolute inset-0 flex items-center justify-center rounded-full"
                    >
                      <Skull class="text-destructive h-4 w-4" />
                    </div>
                  {/if}
                </button>
              {:else}
                <div
                  class={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2',
                    statusConfig.bgColor,
                  )}
                >
                  <statusConfig.icon class={cn('h-3.5 w-3.5', statusConfig.color)} />
                </div>
              {/if}

              <!-- Name & Badge -->
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <span
                  class={cn(
                    'text-sm leading-tight font-medium',
                    character.status === 'active' && 'text-foreground',
                    character.status === 'inactive' && 'text-muted-foreground',
                    character.status === 'deceased' && 'text-muted-foreground line-through',
                  )}
                >
                  {character.translatedName ?? character.name}
                </span>
                {#if isProtagonist}
                  <Badge
                    variant="default"
                    class="h-4 w-fit px-1.5 py-0 text-[10px] tracking-wide uppercase"
                  >
                    <Star class="mr-0.5 h-2.5 w-2.5" />
                    You
                  </Badge>
                {:else if character.relationship || character.translatedRelationship}
                  <Badge
                    variant="secondary"
                    class="text-muted-foreground w-fit px-2 py-0.5 text-[10px] font-normal"
                  >
                    {character.translatedRelationship ?? character.relationship}
                  </Badge>
                {/if}
              </div>
            </div>

            <!-- Swap Protagonist UI -->
            {#if pendingProtagonistId === character.id}
              <div class="border-border bg-muted/40 mt-2 rounded-md border p-2.5">
                <p class="text-muted-foreground mb-1.5 text-xs">
                  New role for <span class="text-foreground font-medium"
                    >{currentProtagonistName}</span
                  >:
                </p>
                <div class="flex gap-2">
                  <Input
                    type="text"
                    bind:value={previousRelationshipLabel}
                    placeholder="e.g., ally, companion"
                    class="h-7 flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    class="h-7 px-3 text-xs"
                    onclick={() => confirmSwap(character)}
                    disabled={!previousRelationshipLabel.trim()}
                  >
                    Swap
                  </Button>
                  <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={cancelSwap}>
                    <X class="h-3.5 w-3.5" />
                  </Button>
                </div>
                {#if swapError}
                  <p class="text-destructive mt-1 text-xs">{swapError}</p>
                {/if}
              </div>
            {/if}

            <!-- Expanded Details -->
            {#if !isCollapsed && hasDetails(character)}
              {@const hasTraits =
                character.traits.length > 0 ||
                (character.translatedTraits && character.translatedTraits.length > 0)}
              {@const displayDescriptors =
                character.translatedVisualDescriptors ?? character.visualDescriptors}
              {@const descriptorsList = hasVisualDescriptors(displayDescriptors)
                ? getVisualDescriptorsList(displayDescriptors)
                : []}
              {@const descriptorsExpanded = expandedDescriptors.has(character.id)}
              <div class="mt-2 flex flex-col gap-1.5">
                {#if hasTraits}
                  <div class="flex flex-wrap gap-1">
                    {#each character.translatedTraits ?? character.traits as trait (trait)}
                      <span
                        class="bg-muted text-muted-foreground inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium"
                      >
                        {trait}
                      </span>
                    {/each}
                  </div>
                {/if}
                {#if descriptorsList.length > 0}
                  <div class="text-[10px]">
                    <button
                      type="button"
                      class="text-muted-foreground hover:text-foreground mb-1 flex items-center gap-1"
                      onclick={() => toggleDescriptorExpand(character.id)}
                    >
                      <ChevronDown
                        class={cn(
                          'h-3 w-3 transition-transform',
                          descriptorsExpanded && 'rotate-180',
                        )}
                      />
                      <span class="font-medium">Appearance</span>
                    </button>
                    {#if descriptorsExpanded}
                      <div class="flex flex-col gap-1">
                        {#each descriptorsList as { label, color, value } (`${character.id}-${label}-${value}`)}
                          <div class="bg-muted/40 flex flex-col gap-0.5 rounded px-2 py-1">
                            <span class={cn('font-medium', color)}>{label}</span>
                            <span class="text-muted-foreground">{value}</span>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <p class="text-muted-foreground line-clamp-2 pl-4">
                        {descriptorsList
                          .slice(0, 3)
                          .map((d) => d.value)
                          .join(' · ')}
                      </p>
                    {/if}
                  </div>
                {/if}
                {#if character.description || character.translatedDescription}
                  <p class="text-muted-foreground text-xs leading-relaxed">
                    {character.translatedDescription ?? character.description}
                  </p>
                {/if}

                <!-- Runtime Variables (Non-pinned, collapsible) -->
                {#if runtimeVarDefs.length > 0}
                  <RuntimeVariableDisplay
                    definitions={runtimeVarDefs}
                    values={character.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                    pinnedOnly={false}
                  />
                {/if}
              </div>
            {/if}

            <!-- Runtime Variables (Pinned, always visible) -->
            {#if runtimeVarDefs.length > 0}
              <RuntimeVariableDisplay
                definitions={runtimeVarDefs}
                values={character.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                pinnedOnly={true}
                class={isCollapsed ? 'mt-2' : 'mt-1'}
              />
            {/if}

            <!-- Footer Actions -->
            <div class="mt-2 flex items-center justify-between">
              <div class="-ml-1.5 flex items-center">
                {#if hasDetails(character)}
                  <Button
                    variant="text"
                    size="icon"
                    class="text-muted-foreground hover:text-foreground h-6 w-6"
                    onclick={() => toggleCollapse(character.id)}
                    title={isCollapsed ? 'Show details' : 'Hide details'}
                  >
                    <ChevronDown
                      class={cn(
                        'h-4 w-4 transition-transform duration-200',
                        !isCollapsed ? 'rotate-180' : '',
                      )}
                    />
                  </Button>
                {/if}
              </div>

              <IconRow
                class="-mr-1.5"
                onDelete={!isProtagonist ? () => deleteCharacter(character) : undefined}
                showDelete={!isProtagonist}
              >
                {#if !isProtagonist}
                  <Button
                    variant="text"
                    size="icon"
                    class="text-muted-foreground h-6 w-6 hover:text-amber-500"
                    onclick={() => beginSwap(character)}
                    title="Make protagonist"
                  >
                    <Star class="h-3.5 w-3.5" />
                  </Button>
                {/if}
                <Button
                  variant="text"
                  size="icon"
                  class="text-muted-foreground hover:text-foreground h-6 w-6"
                  onclick={() => startEdit(character)}
                  title="Edit"
                >
                  <Pencil class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="text"
                  size="icon"
                  class={cn(
                    'h-6 w-6',
                    savedToVaultId === character.id
                      ? 'text-green-500'
                      : 'text-muted-foreground hover:text-primary',
                  )}
                  onclick={() => saveCharacterToVault(character)}
                  title="Save to vault"
                >
                  <Archive class="h-3.5 w-3.5" />
                </Button>
              </IconRow>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Expanded Portrait Modal -->
{#if expandedPortrait}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="bg-background/80 animate-in fade-in fixed inset-0 z-50 flex cursor-pointer items-center justify-center p-4 backdrop-blur-sm duration-200"
    onclick={() => (expandedPortrait = null)}
    role="dialog"
    aria-label="Expanded portrait"
    tabindex="0"
  >
    <div class="relative w-full max-w-sm">
      <img
        src={expandedPortrait.src}
        alt="{expandedPortrait.name} portrait"
        class="border-border h-auto w-full rounded-lg border shadow-2xl"
      />
      <Button
        variant="secondary"
        size="icon"
        class="absolute top-2 right-2 h-8 w-8 rounded-full opacity-70 hover:opacity-100"
        onclick={(e) => {
          e.stopPropagation()
          expandedPortrait = null
        }}
      >
        <X class="h-4 w-4" />
      </Button>
    </div>
  </div>
{/if}
