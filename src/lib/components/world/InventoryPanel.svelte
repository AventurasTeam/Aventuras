<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import {
    Plus,
    Package,
    Shield,
    Pencil,
    ArrowDown,
    ArrowUp,
    MapPin,
    ChevronDown,
    Save,
    X,
  } from 'lucide-svelte'
  import type { Item } from '$lib/types'
  import type { RuntimeVariable, RuntimeVarsMap } from '$lib/services/packs/types'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Badge } from '$lib/components/ui/badge'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Label } from '$lib/components/ui/label'
  import * as Select from '$lib/components/ui/select'
  import IconRow from '$lib/components/ui/icon-row.svelte'
  import { cn } from '$lib/utils/cn'
  import { database } from '$lib/services/database'
  import RuntimeVariableDisplay from './RuntimeVariableDisplay.svelte'

  let showAddForm = $state(false)
  let newName = $state('')
  let newDescription = $state('')
  let newQuantity = $state(1)
  let editingId = $state<string | null>(null)
  let editName = $state('')
  let editDescription = $state('')
  let editQuantity = $state(1)
  let editEquipped = $state(false)
  let droppingItemId = $state<string | null>(null)
  let dropLocationId = $state<string>('')

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
        runtimeVarDefs = await database.getRuntimeVariablesByEntityType(packId, 'item')
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

  const worldItems = $derived(story.items.filter((item) => item.location !== 'inventory'))

  function toggleCollapse(itemId: string) {
    const isCollapsed = ui.isEntityCollapsed(itemId)
    ui.toggleEntityCollapsed(itemId, !isCollapsed)
  }

  async function addItem() {
    if (!newName.trim()) return
    await story.addItem(newName.trim(), newDescription.trim() || undefined, newQuantity)
    newName = ''
    newDescription = ''
    newQuantity = 1
    showAddForm = false
  }

  function startEdit(item: Item) {
    editingId = item.id
    editName = item.name
    editDescription = item.description ?? ''
    editQuantity = item.quantity
    editEquipped = item.equipped
    // Reset other modes
    droppingItemId = null
    // Initialize runtime vars from entity metadata
    const rv = (item.metadata as Record<string, unknown> | null)?.runtimeVars
    editRuntimeVars = rv && typeof rv === 'object' ? { ...(rv as RuntimeVarsMap) } : {}
  }

  function cancelEdit() {
    editingId = null
    editName = ''
    editDescription = ''
    editQuantity = 1
    editEquipped = false
    editRuntimeVars = {}
  }

  async function saveEdit(item: Item) {
    const name = editName.trim()
    if (!name) return

    const quantity = Math.max(1, Number(editQuantity) || 1)

    // Merge runtime vars into metadata
    const existingMeta = (item.metadata as Record<string, unknown>) ?? {}
    const hasRuntimeVarEdits = Object.keys(editRuntimeVars).length > 0
    const updatedMetadata = hasRuntimeVarEdits
      ? {
          ...existingMeta,
          runtimeVars: {
            ...((existingMeta.runtimeVars as RuntimeVarsMap) ?? {}),
            ...editRuntimeVars,
          },
        }
      : item.metadata

    await story.updateItem(item.id, {
      name,
      description: editDescription.trim() || null,
      quantity,
      equipped: item.location === 'inventory' ? editEquipped : false,
      metadata: updatedMetadata,
    })

    cancelEdit()
  }

  async function deleteItem(item: Item) {
    await story.deleteItem(item.id)
  }

  function beginDrop(item: Item) {
    droppingItemId = item.id
    const preferredLocation = story.locations.find((loc) => loc.id === item.location)?.id
    dropLocationId = preferredLocation || story.currentLocation?.id || story.locations[0]?.id || ''
    // Reset other modes
    editingId = null
  }

  function cancelDrop() {
    droppingItemId = null
    dropLocationId = ''
  }

  async function dropItem(item: Item) {
    if (!dropLocationId) return
    await story.updateItem(item.id, {
      location: dropLocationId,
      equipped: false,
    })
    cancelDrop()
  }

  async function pickUpItem(item: Item) {
    await story.updateItem(item.id, {
      location: 'inventory',
    })
  }

  async function moveItemToLocation(item: Item) {
    if (!dropLocationId) return
    await story.updateItem(item.id, {
      location: dropLocationId,
    })
    cancelDrop()
  }

  function getLocationLabel(locationId: string) {
    if (locationId === 'inventory') return 'Inventory'
    const location = story.locations.find((loc) => loc.id === locationId)
    return location?.name || 'Unknown location'
  }

  function hasDescription(item: Item): boolean {
    return !!(item.description || item.translatedDescription)
  }
</script>

<div class="flex flex-col gap-1 pb-12">
  <!-- Header -->
  <div class="mb-2 flex items-center justify-between">
    <h3 class="text-foreground text-xl font-bold tracking-tight">Inventory</h3>
    <Button
      variant="text"
      size="icon"
      class="text-muted-foreground hover:text-foreground h-6 w-6"
      onclick={() => (showAddForm = !showAddForm)}
      title="Add item"
    >
      <Plus class="h-6! w-6!" />
    </Button>
  </div>

  {#if showAddForm}
    <div class="border-border bg-card mb-2 rounded-lg border p-3 shadow-sm">
      <div class="space-y-3">
        <Input type="text" bind:value={newName} placeholder="Item name" class="h-8 text-sm" />
        <Textarea
          bind:value={newDescription}
          placeholder="Description (optional)"
          class="min-h-15 resize-none text-sm"
          rows={2}
        />
        <div class="flex items-center justify-end gap-3">
          <div class="flex items-center gap-2">
            <Label class="text-muted-foreground text-xs">Quantity</Label>
            <Input type="number" bind:value={newQuantity} min="1" class="h-8 w-20 text-sm" />
          </div>
        </div>
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <Button variant="text" size="sm" class="h-7" onclick={() => (showAddForm = false)}>
          Cancel
        </Button>
        <Button size="sm" class="h-7" onclick={addItem} disabled={!newName.trim()}>Add</Button>
      </div>
    </div>
  {/if}

  <!-- Equipped Items -->
  {#if story.equippedItems.length > 0}
    <div class="mb-4 space-y-2">
      <h4 class="text-muted-foreground pl-1 text-xs font-semibold tracking-wider uppercase">
        Equipped
      </h4>
      {#each story.equippedItems as item (item.id)}
        {@const isCollapsed = ui.isEntityCollapsed(item.id)}
        {@const isEditing = editingId === item.id}

        <div
          class={cn(
            'group bg-card rounded-lg border px-2.5 py-2 shadow-sm transition-all',
            isEditing ? 'ring-primary/20 border-border ring-1' : 'border-primary/40',
          )}
        >
          {#if isEditing}
            <!-- EDIT MODE -->
            <div class="space-y-3">
              <div class="mb-2 flex items-center justify-between">
                <h4 class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Editing {item.name}
                </h4>
                <Button variant="text" size="icon" class="h-6 w-6" onclick={cancelEdit}
                  ><X class="h-4 w-4" /></Button
                >
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="col-span-2 space-y-1 sm:col-span-1">
                  <Label class="text-xs">Name</Label>
                  <Input
                    type="text"
                    bind:value={editName}
                    placeholder="Item name"
                    class="h-8 text-sm"
                  />
                </div>
                <div class="col-span-2 space-y-1 sm:col-span-1">
                  <Label class="text-xs">Quantity</Label>
                  <Input type="number" bind:value={editQuantity} min="1" class="h-8 text-sm" />
                </div>
              </div>

              <div class="bg-muted/20 flex items-center space-x-2 rounded-md border p-2">
                <Checkbox id="edit-equipped-{item.id}" bind:checked={editEquipped} />
                <Label
                  for="edit-equipped-{item.id}"
                  class="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Equipped
                </Label>
              </div>

              <div class="space-y-1">
                <Label class="text-xs">Description</Label>
                <Textarea
                  bind:value={editDescription}
                  placeholder="Description"
                  class="min-h-15 resize-none text-xs"
                />
              </div>

              <!-- Runtime Variables (Edit - Equipped) -->
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
                  onclick={() => saveEdit(item)}
                  disabled={!editName.trim()}
                >
                  <Save class="mr-1.5 h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
            </div>
          {:else if droppingItemId === item.id}
            <!-- DROP MODE -->
            <div class="space-y-3">
              <div class="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
                <MapPin class="h-3.5 w-3.5" />
                <span>Drop item at...</span>
              </div>

              <Select.Root type="single" bind:value={dropLocationId}>
                <Select.Trigger class="h-8 text-xs">
                  <div class="flex items-center gap-2 overflow-hidden">
                    <span class="truncate">
                      {story.locations.find((l) => l.id === dropLocationId)?.name ||
                        'Select location'}
                    </span>
                  </div>
                </Select.Trigger>
                <Select.Content class="max-h-50">
                  {#if story.locations.length === 0}
                    <Select.Item value="" disabled>No locations available</Select.Item>
                  {:else}
                    {#each story.locations as location (location.id)}
                      <Select.Item value={location.id} label={location.name}
                        >{location.name}</Select.Item
                      >
                    {/each}
                  {/if}
                </Select.Content>
              </Select.Root>

              <div class="flex justify-end gap-2">
                <Button variant="text" size="sm" class="h-7 text-xs" onclick={cancelDrop}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  class="h-7 px-4 text-xs"
                  onclick={() => dropItem(item)}
                  disabled={!dropLocationId}
                >
                  Drop
                </Button>
              </div>
            </div>
          {:else}
            <!-- VIEW MODE -->
            <div class="flex items-start gap-2.5">
              <!-- Icon -->
              <div
                class="bg-primary/10 ring-primary/50 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2"
              >
                <Shield class="h-3.5 w-3.5" />
              </div>

              <!-- Name & Quantity -->
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="text-foreground text-sm leading-tight font-medium">
                  {item.translatedName ?? item.name}
                </span>
                <div class="flex items-center gap-1.5">
                  <Badge
                    variant="default"
                    class="h-4 w-fit px-1.5 py-0 text-[10px] tracking-wide uppercase"
                  >
                    Equipped
                  </Badge>
                  {#if item.quantity > 1}
                    <Badge variant="secondary" class="h-4 px-1.5 text-[10px]">
                      x{item.quantity}
                    </Badge>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Expanded Details -->
            {#if !isCollapsed && hasDescription(item)}
              <div class="text-muted-foreground mt-2 text-xs">
                <p class="leading-relaxed">
                  {item.translatedDescription ?? item.description}
                </p>
              </div>

              <!-- Runtime Variables (Non-pinned, collapsible - Equipped) -->
              {#if runtimeVarDefs.length > 0}
                <RuntimeVariableDisplay
                  definitions={runtimeVarDefs}
                  values={item.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                  pinnedOnly={false}
                  class="mt-1.5"
                />
              {/if}
            {/if}

            <!-- Runtime Variables (Pinned, always visible - Equipped) -->
            {#if runtimeVarDefs.length > 0}
              <RuntimeVariableDisplay
                definitions={runtimeVarDefs}
                values={item.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                pinnedOnly={true}
                class={isCollapsed ? 'mt-2' : 'mt-1'}
              />
            {/if}

            <!-- Footer Actions -->
            <div class="mt-2 flex items-center justify-between">
              <div class="-ml-1.5 flex items-center">
                {#if hasDescription(item)}
                  <Button
                    variant="text"
                    size="icon"
                    class="text-muted-foreground hover:text-foreground h-6 w-6"
                    onclick={() => toggleCollapse(item.id)}
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

              <IconRow class="-mr-1.5" onDelete={() => deleteItem(item)} showDelete={true}>
                <Button
                  variant="text"
                  size="icon"
                  class="text-muted-foreground hover:text-foreground h-6 w-6"
                  onclick={() => beginDrop(item)}
                  title="Drop item"
                >
                  <ArrowDown class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="text"
                  size="icon"
                  class="text-muted-foreground hover:text-foreground h-6 w-6"
                  onclick={() => startEdit(item)}
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

  <!-- Inventory Items -->
  {#if story.inventoryItems.filter((item) => !item.equipped).length > 0}
    <div class="space-y-2">
      {#if story.equippedItems.length > 0}
        <h4 class="text-muted-foreground mt-4 pl-1 text-xs font-semibold tracking-wider uppercase">
          Backpack
        </h4>
      {/if}
      {#each story.inventoryItems.filter((item) => !item.equipped) as item (item.id)}
        {@const isCollapsed = ui.isEntityCollapsed(item.id)}
        {@const isEditing = editingId === item.id}

        <div
          class={cn(
            'group bg-card rounded-lg border px-2.5 py-2 shadow-sm transition-all',
            isEditing ? 'ring-primary/20 border-border ring-1' : 'border-muted-foreground/20',
          )}
        >
          {#if isEditing}
            <!-- EDIT MODE (Same as above) -->
            <div class="space-y-3">
              <div class="mb-2 flex items-center justify-between">
                <h4 class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Editing {item.name}
                </h4>
                <Button variant="text" size="icon" class="h-6 w-6" onclick={cancelEdit}
                  ><X class="h-4 w-4" /></Button
                >
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="col-span-2 space-y-1 sm:col-span-1">
                  <Label class="text-xs">Name</Label>
                  <Input
                    type="text"
                    bind:value={editName}
                    placeholder="Item name"
                    class="h-8 text-sm"
                  />
                </div>
                <div class="col-span-2 space-y-1 sm:col-span-1">
                  <Label class="text-xs">Quantity</Label>
                  <Input type="number" bind:value={editQuantity} min="1" class="h-8 text-sm" />
                </div>
              </div>

              <div class="bg-muted/20 flex items-center space-x-2 rounded-md border p-2">
                <Checkbox id="edit-equipped-{item.id}" bind:checked={editEquipped} />
                <Label
                  for="edit-equipped-{item.id}"
                  class="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Equipped
                </Label>
              </div>

              <div class="space-y-1">
                <Label class="text-xs">Description</Label>
                <Textarea
                  bind:value={editDescription}
                  placeholder="Description"
                  class="min-h-[60px] resize-none text-xs"
                />
              </div>

              <!-- Runtime Variables (Edit - Backpack) -->
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
                  onclick={() => saveEdit(item)}
                  disabled={!editName.trim()}
                >
                  <Save class="mr-1.5 h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
            </div>
          {:else if droppingItemId === item.id}
            <!-- DROP MODE -->
            <div class="space-y-3">
              <div class="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
                <MapPin class="h-3.5 w-3.5" />
                <span>Drop item at...</span>
              </div>

              <Select.Root type="single" bind:value={dropLocationId}>
                <Select.Trigger class="h-8 text-xs">
                  <div class="flex items-center gap-2 overflow-hidden">
                    <span class="truncate">
                      {story.locations.find((l) => l.id === dropLocationId)?.name ||
                        'Select location'}
                    </span>
                  </div>
                </Select.Trigger>
                <Select.Content class="max-h-[200px]">
                  {#if story.locations.length === 0}
                    <Select.Item value="" disabled>No locations available</Select.Item>
                  {:else}
                    {#each story.locations as location (location.id)}
                      <Select.Item value={location.id} label={location.name}
                        >{location.name}</Select.Item
                      >
                    {/each}
                  {/if}
                </Select.Content>
              </Select.Root>

              <div class="flex justify-end gap-2">
                <Button variant="text" size="sm" class="h-7 text-xs" onclick={cancelDrop}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  class="h-7 px-4 text-xs"
                  onclick={() => dropItem(item)}
                  disabled={!dropLocationId}
                >
                  Drop
                </Button>
              </div>
            </div>
          {:else}
            <!-- VIEW MODE -->
            <div class="flex items-start gap-2.5">
              <!-- Icon -->
              <div
                class="bg-secondary/50 ring-muted-foreground/30 text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2"
              >
                <Package class="h-3.5 w-3.5" />
              </div>

              <!-- Name & Quantity -->
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="text-foreground text-sm leading-tight font-medium">
                  {item.translatedName ?? item.name}
                </span>
                {#if item.quantity > 1}
                  <Badge variant="secondary" class="h-4 w-fit px-1.5 text-[10px]">
                    x{item.quantity}
                  </Badge>
                {/if}
              </div>
            </div>

            <!-- Expanded Details -->
            {#if !isCollapsed && hasDescription(item)}
              <div class="text-muted-foreground mt-2 text-xs">
                <p class="leading-relaxed">
                  {item.translatedDescription ?? item.description}
                </p>
              </div>

              <!-- Runtime Variables (Non-pinned, collapsible - Backpack) -->
              {#if runtimeVarDefs.length > 0}
                <RuntimeVariableDisplay
                  definitions={runtimeVarDefs}
                  values={item.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                  pinnedOnly={false}
                  class="mt-1.5"
                />
              {/if}
            {/if}

            <!-- Runtime Variables (Pinned, always visible - Backpack) -->
            {#if runtimeVarDefs.length > 0}
              <RuntimeVariableDisplay
                definitions={runtimeVarDefs}
                values={item.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                pinnedOnly={true}
                class={isCollapsed ? 'mt-2' : 'mt-1'}
              />
            {/if}

            <!-- Footer Actions -->
            <div class="mt-2 flex items-center justify-between">
              <div class="-ml-1.5 flex items-center">
                {#if hasDescription(item)}
                  <Button
                    variant="text"
                    size="icon"
                    class="text-muted-foreground hover:text-foreground h-6 w-6"
                    onclick={() => toggleCollapse(item.id)}
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

              <IconRow class="-mr-1.5" onDelete={() => deleteItem(item)} showDelete={true}>
                <Button
                  variant="text"
                  size="icon"
                  class="text-muted-foreground hover:text-foreground h-6 w-6"
                  onclick={() => beginDrop(item)}
                  title="Drop item"
                >
                  <ArrowDown class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="text"
                  size="icon"
                  class="text-muted-foreground hover:text-foreground h-6 w-6"
                  onclick={() => startEdit(item)}
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

  <!-- Empty State (Only if no equipped and no inventory) -->
  {#if story.inventoryItems.length === 0 && story.equippedItems.length === 0}
    <div
      class="border-border bg-muted/20 flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center"
    >
      <div class="bg-muted mb-3 rounded-full p-3">
        <Package class="text-muted-foreground h-6 w-6" />
      </div>
      <p class="text-muted-foreground text-sm">Empty inventory</p>
      <Button
        variant="text"
        class="text-primary mt-1 h-auto p-0 text-xs"
        onclick={() => (showAddForm = true)}
      >
        <Plus class="h-3.5 w-3.5" />
        Add first item
      </Button>
    </div>
  {/if}

  <!-- World Items -->
  {#if worldItems.length > 0}
    <div class="mt-4 space-y-2">
      <h4 class="text-muted-foreground pl-1 text-xs font-semibold tracking-wider uppercase">
        World Items
      </h4>
      {#each worldItems as item (item.id)}
        {@const isCollapsed = ui.isEntityCollapsed(item.id)}
        {@const isEditing = editingId === item.id}

        <div
          class={cn(
            'group border-border bg-card rounded-lg border pt-3 pr-2 pb-2 pl-3 shadow-sm transition-all',
            isEditing ? 'ring-primary/20 ring-1' : '',
          )}
        >
          {#if isEditing}
            <!-- EDIT MODE (Same as above) -->
            <div class="space-y-3">
              <div class="mb-2 flex items-center justify-between">
                <h4 class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Editing {item.name}
                </h4>
                <Button variant="text" size="icon" class="h-6 w-6" onclick={cancelEdit}
                  ><X class="h-4 w-4" /></Button
                >
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="col-span-2 space-y-1 sm:col-span-1">
                  <Label class="text-xs">Name</Label>
                  <Input
                    type="text"
                    bind:value={editName}
                    placeholder="Item name"
                    class="h-8 text-sm"
                  />
                </div>
                <div class="col-span-2 space-y-1 sm:col-span-1">
                  <Label class="text-xs">Quantity</Label>
                  <Input type="number" bind:value={editQuantity} min="1" class="h-8 text-sm" />
                </div>
              </div>

              <!-- No Equipped checkbox for world items usually, but keeping it consistent with function logic -->
              <!-- The saveEdit function handles forcing equipped=false for non-inventory items -->

              <div class="space-y-1">
                <Label class="text-xs">Description</Label>
                <Textarea
                  bind:value={editDescription}
                  placeholder="Description"
                  class="min-h-15 resize-none text-xs"
                />
              </div>

              <!-- Runtime Variables (Edit - World) -->
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
                  onclick={() => saveEdit(item)}
                  disabled={!editName.trim()}
                >
                  <Save class="mr-1.5 h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
            </div>
          {:else if droppingItemId === item.id}
            <!-- MOVE MODE -->
            <div class="space-y-3">
              <div class="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
                <MapPin class="h-3.5 w-3.5" />
                <span>Move item to...</span>
              </div>

              <Select.Root type="single" bind:value={dropLocationId}>
                <Select.Trigger class="h-8 text-xs">
                  <div class="flex items-center gap-2 overflow-hidden">
                    <span class="truncate">
                      {story.locations.find((l) => l.id === dropLocationId)?.name ||
                        'Select location'}
                    </span>
                  </div>
                </Select.Trigger>
                <Select.Content class="max-h-[200px]">
                  {#if story.locations.length === 0}
                    <Select.Item value="" disabled>No locations available</Select.Item>
                  {:else}
                    {#each story.locations as location (location.id)}
                      <Select.Item value={location.id} label={location.name}
                        >{location.name}</Select.Item
                      >
                    {/each}
                  {/if}
                </Select.Content>
              </Select.Root>

              <div class="flex justify-end gap-2">
                <Button variant="text" size="sm" class="h-7 text-xs" onclick={cancelDrop}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  class="h-7 px-4 text-xs"
                  onclick={() => moveItemToLocation(item)}
                  disabled={!dropLocationId}
                >
                  Move
                </Button>
              </div>
            </div>
          {:else}
            <!-- VIEW MODE -->
            <div class="flex items-start gap-2.5">
              <!-- Icon -->
              <div
                class="bg-muted/50 ring-muted-foreground/20 text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full opacity-60 ring-2"
              >
                <Package class="h-3.5 w-3.5" />
              </div>

              <!-- Name & Location -->
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="text-muted-foreground text-sm leading-tight font-medium">
                  {item.translatedName ?? item.name}
                </span>
                <div class="flex items-center gap-1.5">
                  <Badge
                    variant="secondary"
                    class="text-muted-foreground h-4 w-fit px-1.5 py-0 text-[10px] font-normal"
                  >
                    {getLocationLabel(item.location)}
                  </Badge>
                  {#if item.quantity > 1}
                    <Badge variant="secondary" class="h-4 w-fit px-1.5 text-[10px]">
                      x{item.quantity}
                    </Badge>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Expanded Details -->
            {#if !isCollapsed && hasDescription(item)}
              <div class="text-muted-foreground mt-2 text-xs">
                <p class="leading-relaxed">
                  {item.translatedDescription ?? item.description}
                </p>
              </div>

              <!-- Runtime Variables (Non-pinned, collapsible - World) -->
              {#if runtimeVarDefs.length > 0}
                <RuntimeVariableDisplay
                  definitions={runtimeVarDefs}
                  values={item.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                  pinnedOnly={false}
                  class="mt-1.5"
                />
              {/if}
            {/if}

            <!-- Runtime Variables (Pinned, always visible - World) -->
            {#if runtimeVarDefs.length > 0}
              <RuntimeVariableDisplay
                definitions={runtimeVarDefs}
                values={item.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                pinnedOnly={true}
                class={isCollapsed ? 'mt-2' : 'mt-1'}
              />
            {/if}

            <!-- Footer Actions -->
            <div class="mt-2 flex items-center justify-between">
              <div class="-ml-1.5 flex items-center">
                {#if hasDescription(item)}
                  <Button
                    variant="text"
                    size="icon"
                    class="text-muted-foreground hover:text-foreground h-6 w-6"
                    onclick={() => toggleCollapse(item.id)}
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

              <IconRow class="-mr-1.5" onDelete={() => deleteItem(item)} showDelete={true}>
                <Button
                  variant="text"
                  size="icon"
                  class="text-muted-foreground hover:text-foreground h-6 w-6"
                  onclick={() => pickUpItem(item)}
                  title="Pick up"
                >
                  <ArrowUp class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="text"
                  size="icon"
                  class="text-muted-foreground hover:text-foreground h-6 w-6"
                  onclick={() => beginDrop(item)}
                  title="Move item"
                >
                  <MapPin class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="text"
                  size="icon"
                  class="text-muted-foreground hover:text-foreground h-6 w-6"
                  onclick={() => startEdit(item)}
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
