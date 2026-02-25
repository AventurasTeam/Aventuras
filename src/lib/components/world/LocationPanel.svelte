<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { Plus, MapPin, Navigation, Pencil, ChevronDown, Save, X } from 'lucide-svelte'
  import type { Location } from '$lib/types'
  import type { RuntimeVariable, RuntimeVarsMap } from '$lib/services/packs/types'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Label } from '$lib/components/ui/label'
  import { cn } from '$lib/utils/cn'
  import IconRow from '$lib/components/ui/icon-row.svelte'
  import { database } from '$lib/services/database'
  import RuntimeVariableDisplay from './RuntimeVariableDisplay.svelte'

  let showAddForm = $state(false)
  let newName = $state('')
  let newDescription = $state('')
  let editingId = $state<string | null>(null)
  let editName = $state('')
  let editDescription = $state('')

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
        runtimeVarDefs = await database.getRuntimeVariablesByEntityType(packId, 'location')
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

  function toggleCollapse(locationId: string) {
    const isCollapsed = ui.isEntityCollapsed(locationId)
    ui.toggleEntityCollapsed(locationId, !isCollapsed)
  }

  async function addLocation() {
    if (!newName.trim()) return
    const makeCurrent = story.locations.length === 0
    await story.addLocation(newName.trim(), newDescription.trim() || undefined, makeCurrent)
    newName = ''
    newDescription = ''
    showAddForm = false
  }

  async function goToLocation(locationId: string) {
    await story.setCurrentLocation(locationId)
  }

  async function toggleVisited(locationId: string) {
    await story.toggleLocationVisited(locationId)
  }

  async function deleteLocation(location: Location) {
    await story.deleteLocation(location.id)
  }

  function startEdit(location: Location) {
    editingId = location.id
    editName = location.name
    editDescription = location.description ?? ''
    // Initialize runtime vars from entity metadata
    const rv = (location.metadata as Record<string, unknown> | null)?.runtimeVars
    editRuntimeVars = rv && typeof rv === 'object' ? { ...(rv as RuntimeVarsMap) } : {}
  }

  function cancelEdit() {
    editingId = null
    editName = ''
    editDescription = ''
    editRuntimeVars = {}
  }

  async function saveEdit(location: Location) {
    const name = editName.trim()
    if (!name) return

    // Merge runtime vars into metadata
    const existingMeta = (location.metadata as Record<string, unknown>) ?? {}
    const hasRuntimeVarEdits = Object.keys(editRuntimeVars).length > 0
    const updatedMetadata = hasRuntimeVarEdits
      ? {
          ...existingMeta,
          runtimeVars: {
            ...((existingMeta.runtimeVars as RuntimeVarsMap) ?? {}),
            ...editRuntimeVars,
          },
        }
      : location.metadata

    await story.updateLocation(location.id, {
      name,
      description: editDescription.trim() || null,
      metadata: updatedMetadata,
    })
    cancelEdit()
  }
</script>

<div class="flex flex-col gap-1 pb-12">
  <!-- Header -->
  <div class="mb-2 flex items-center justify-between">
    <h3 class="text-foreground text-xl font-bold tracking-tight">Locations</h3>
    <Button
      variant="text"
      size="icon"
      class="text-muted-foreground hover:text-foreground h-6 w-6"
      onclick={() => (showAddForm = !showAddForm)}
      title="Add location"
    >
      <Plus class="h-6! w-6!" />
    </Button>
  </div>

  <!-- Add Form -->
  {#if showAddForm}
    <div class="border-border bg-card rounded-lg border p-3 shadow-sm">
      <div class="space-y-3">
        <Input type="text" bind:value={newName} placeholder="Location name" class="h-8 text-sm" />
        <Textarea
          bind:value={newDescription}
          placeholder="Description (optional)"
          class="min-h-[60px] resize-none text-sm"
          rows={2}
        />
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <Button variant="text" size="sm" class="h-7" onclick={() => (showAddForm = false)}>
          Cancel
        </Button>
        <Button size="sm" class="h-7" onclick={addLocation} disabled={!newName.trim()}>Add</Button>
      </div>
    </div>
  {/if}

  <!-- Current Location -->
  {#if story.currentLocation}
    {@const currentLocation = story.currentLocation}
    {@const isEditing = editingId === currentLocation.id}
    {@const isCollapsed = ui.isEntityCollapsed(currentLocation.id)}

    <div
      class={cn(
        'bg-accent-500/5 mb-2 rounded-lg border px-2.5 py-2 shadow-sm',
        isEditing ? 'ring-primary/20 border-border ring-1' : 'border-accent-500/50',
      )}
    >
      {#if isEditing}
        <!-- EDIT MODE (Current) -->
        <div class="space-y-3">
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-accent-400 text-xs font-semibold tracking-wider uppercase">
              Editing Current Location
            </h4>
            <Button variant="text" size="icon" class="h-6 w-6" onclick={cancelEdit}
              ><X class="h-4 w-4" /></Button
            >
          </div>

          <div class="space-y-1">
            <Input
              type="text"
              bind:value={editName}
              placeholder="Location name"
              class="h-8 text-sm"
            />
          </div>

          <div class="space-y-1">
            <Textarea
              bind:value={editDescription}
              placeholder="Description"
              class="min-h-[60px] resize-none text-xs"
            />
          </div>

          <!-- Runtime Variables (Edit - Current) -->
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

          <div class="border-accent-500/30 flex justify-end gap-2 border-t pt-2">
            <Button variant="text" size="sm" class="h-7 text-xs" onclick={cancelEdit}>
              Cancel
            </Button>
            <Button
              size="sm"
              class="h-7 px-4 text-xs"
              onclick={() => saveEdit(currentLocation)}
              disabled={!editName.trim()}
            >
              <Save class="mr-1.5 h-3.5 w-3.5" />
              Save
            </Button>
          </div>
        </div>
      {:else}
        <!-- DISPLAY MODE (Current) -->
        <div class="flex items-start gap-2.5">
          <!-- Current Location Icon -->
          <div
            class="bg-accent-500/20 ring-accent-500/50 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2"
          >
            <Navigation class="text-accent-500 h-3.5 w-3.5" />
          </div>

          <!-- Name & Badge -->
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="text-foreground text-sm leading-tight font-medium">
              {currentLocation.translatedName ?? currentLocation.name}
            </span>
            <span class="text-accent-500 w-fit text-[10px] font-bold tracking-wider uppercase">
              Current Location
            </span>
          </div>
        </div>

        <!-- Expanded Details -->
        {#if !isCollapsed && (currentLocation.description || currentLocation.translatedDescription)}
          <div class="text-muted-foreground mt-2 text-xs">
            <p class="leading-relaxed whitespace-pre-wrap">
              {currentLocation.translatedDescription ?? currentLocation.description}
            </p>
          </div>

          <!-- Runtime Variables (Non-pinned, collapsible - Current) -->
          {#if runtimeVarDefs.length > 0}
            <RuntimeVariableDisplay
              definitions={runtimeVarDefs}
              values={currentLocation.metadata?.runtimeVars as RuntimeVarsMap | undefined}
              pinnedOnly={false}
              class="mt-1.5"
            />
          {/if}
        {/if}

        <!-- Runtime Variables (Pinned, always visible - Current) -->
        {#if runtimeVarDefs.length > 0}
          <RuntimeVariableDisplay
            definitions={runtimeVarDefs}
            values={currentLocation.metadata?.runtimeVars as RuntimeVarsMap | undefined}
            pinnedOnly={true}
            class={isCollapsed ? 'mt-2' : 'mt-1'}
          />
        {/if}

        <!-- Footer Actions -->
        <div class="mt-2 flex items-center justify-between">
          <div class="-ml-1.5 flex items-center">
            {#if currentLocation.description || currentLocation.translatedDescription}
              <Button
                variant="text"
                size="icon"
                class="text-accent-500 hover:text-accent-600 h-6 w-6"
                onclick={() => toggleCollapse(currentLocation.id)}
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

          <div class="-mr-1.5 flex items-center gap-0.5">
            <Button
              variant="text"
              size="icon"
              class="text-accent-500 hover:text-accent-600 h-6 w-6"
              onclick={() => startEdit(currentLocation)}
              title="Edit location"
            >
              <Pencil class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Location List -->
  {#if story.locations.filter((l) => !l.current).length === 0 && !story.currentLocation}
    <div
      class="border-border bg-muted/20 flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center"
    >
      <div class="bg-muted mb-3 rounded-full p-3">
        <MapPin class="text-muted-foreground h-6 w-6" />
      </div>
      <p class="text-muted-foreground text-sm">No locations yet</p>
      <Button
        variant="link"
        class="text-primary mt-1 h-auto p-0 text-xs"
        onclick={() => (showAddForm = true)}
      >
        <Plus class="mr-1.5 h-3.5 w-3.5" />
        Add your first location
      </Button>
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      {#each story.locations.filter((l) => !l.current) as location (location.id)}
        {@const isCollapsed = ui.isEntityCollapsed(location.id)}
        {@const isEditing = editingId === location.id}

        <div
          class={cn(
            'group bg-card rounded-lg border px-2.5 py-2 shadow-sm transition-all',
            isEditing && 'ring-primary/20 border-border ring-1',
            !isEditing && location.visited && 'border-muted-foreground/20',
            !isEditing && !location.visited && 'border-primary/30',
          )}
        >
          {#if isEditing}
            <!-- EDIT MODE -->
            <div class="space-y-3">
              <div class="mb-2 flex items-center justify-between">
                <h4 class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Editing {location.name}
                </h4>
                <Button variant="text" size="icon" class="h-6 w-6" onclick={cancelEdit}
                  ><X class="h-4 w-4" /></Button
                >
              </div>

              <div class="space-y-1">
                <Label class="text-xs">Name</Label>
                <Input
                  type="text"
                  bind:value={editName}
                  placeholder="Location name"
                  class="h-8 text-sm"
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

              <div class="border-border flex justify-end gap-2 border-t pt-2">
                <Button variant="text" size="sm" class="h-7 text-xs" onclick={cancelEdit}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  class="h-7 px-4 text-xs"
                  onclick={() => saveEdit(location)}
                  disabled={!editName.trim()}
                >
                  <Save class="mr-1.5 h-3.5 w-3.5" />
                  Save Changes
                </Button>
              </div>
            </div>
          {:else}
            <!-- DISPLAY MODE -->
            <div class="flex items-start gap-2.5">
              <!-- Visited Status Icon -->
              <button
                class={cn(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ring-2 transition-colors',
                  location.visited
                    ? 'bg-muted/50 ring-muted-foreground/30 text-muted-foreground hover:bg-muted'
                    : 'bg-primary/10 ring-primary/50 text-primary hover:bg-primary/20',
                )}
                onclick={() => toggleVisited(location.id)}
                title={location.visited ? 'Mark as unvisited' : 'Mark as visited'}
              >
                <MapPin class={cn('h-3.5 w-3.5', location.visited && 'opacity-60')} />
              </button>

              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <span
                  class={cn(
                    'text-sm leading-tight font-medium',
                    location.visited ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {location.translatedName ?? location.name}
                </span>
                <span
                  class={cn(
                    'w-fit text-[10px] font-medium tracking-wider uppercase',
                    location.visited ? 'text-muted-foreground/70' : 'text-primary',
                  )}
                >
                  {location.visited ? 'Visited' : 'Unvisited'}
                </span>
              </div>
            </div>

            <!-- Description (Expanded) -->
            {#if !isCollapsed && (location.description || location.translatedDescription)}
              <div class="text-muted-foreground mt-2 text-xs">
                <p class="leading-relaxed whitespace-pre-wrap">
                  {location.translatedDescription ?? location.description}
                </p>
              </div>

              <!-- Runtime Variables (Non-pinned, collapsible) -->
              {#if runtimeVarDefs.length > 0}
                <RuntimeVariableDisplay
                  definitions={runtimeVarDefs}
                  values={location.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                  pinnedOnly={false}
                  class="mt-1.5"
                />
              {/if}
            {/if}

            <!-- Runtime Variables (Pinned, always visible) -->
            {#if runtimeVarDefs.length > 0}
              <RuntimeVariableDisplay
                definitions={runtimeVarDefs}
                values={location.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                pinnedOnly={true}
                class={isCollapsed ? 'mt-2' : 'mt-1'}
              />
            {/if}

            <!-- Footer Actions -->
            <div class="mt-2 flex items-center justify-between">
              <div class="-ml-1.5 flex items-center">
                {#if location.description || location.translatedDescription}
                  <Button
                    variant="text"
                    size="icon"
                    class="text-muted-foreground hover:text-foreground h-6 w-6"
                    onclick={() => toggleCollapse(location.id)}
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

              <IconRow class="-mr-1.5" onDelete={() => deleteLocation(location)} showDelete={true}>
                <Button
                  variant="text"
                  size="sm"
                  class="text-muted-foreground hover:text-primary h-6 text-xs"
                  onclick={() => goToLocation(location.id)}
                  title="Travel to location"
                >
                  <Navigation class="mr-1 h-3 w-3" />
                  Travel
                </Button>
                <Button
                  variant="text"
                  size="icon"
                  class="text-muted-foreground hover:text-foreground h-6 w-6"
                  onclick={() => startEdit(location)}
                  title="Edit"
                >
                  <Pencil class="h-3.5 w-3.5" />
                </Button>
              </IconRow>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
