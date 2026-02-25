<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import {
    Plus,
    Target,
    CheckCircle,
    XCircle,
    Circle,
    Pencil,
    ChevronDown,
    Save,
    X,
  } from 'lucide-svelte'
  import type { StoryBeat } from '$lib/types'
  import type { RuntimeVariable, RuntimeVarsMap } from '$lib/services/packs/types'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Badge } from '$lib/components/ui/badge'
  import { Label } from '$lib/components/ui/label'
  import * as Select from '$lib/components/ui/select'
  import IconRow from '$lib/components/ui/icon-row.svelte'
  import { cn } from '$lib/utils/cn'
  import { database } from '$lib/services/database'
  import RuntimeVariableDisplay from './RuntimeVariableDisplay.svelte'

  let showAddForm = $state(false)
  let newTitle = $state('')
  let newDescription = $state('')
  let newType = $state<StoryBeat['type']>('quest')
  let editingId = $state<string | null>(null)
  let editTitle = $state('')
  let editDescription = $state('')
  let editType = $state<StoryBeat['type']>('quest')
  let editStatus = $state<StoryBeat['status']>('pending')

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
        runtimeVarDefs = await database.getRuntimeVariablesByEntityType(packId, 'story_beat')
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

  function toggleCollapse(beatId: string) {
    const isCollapsed = ui.isEntityCollapsed(beatId)
    ui.toggleEntityCollapsed(beatId, !isCollapsed)
  }

  async function addBeat() {
    if (!newTitle.trim()) return
    await story.addStoryBeat(newTitle.trim(), newType, newDescription.trim() || undefined)
    newTitle = ''
    newDescription = ''
    newType = 'quest'
    showAddForm = false
  }

  function startEdit(beat: StoryBeat) {
    editingId = beat.id
    editTitle = beat.title
    editDescription = beat.description ?? ''
    editType = beat.type
    editStatus = beat.status
    // Initialize runtime vars from entity metadata
    const rv = (beat.metadata as Record<string, unknown> | null)?.runtimeVars
    editRuntimeVars = rv && typeof rv === 'object' ? { ...(rv as RuntimeVarsMap) } : {}
  }

  function cancelEdit() {
    editingId = null
    editTitle = ''
    editDescription = ''
    editType = 'quest'
    editStatus = 'pending'
    editRuntimeVars = {}
  }

  async function saveEdit(beat: StoryBeat) {
    const title = editTitle.trim()
    if (!title) return

    // Merge runtime vars into metadata
    const existingMeta = (beat.metadata as Record<string, unknown>) ?? {}
    const hasRuntimeVarEdits = Object.keys(editRuntimeVars).length > 0
    const updatedMetadata = hasRuntimeVarEdits
      ? {
          ...existingMeta,
          runtimeVars: {
            ...((existingMeta.runtimeVars as RuntimeVarsMap) ?? {}),
            ...editRuntimeVars,
          },
        }
      : beat.metadata

    await story.updateStoryBeat(beat.id, {
      title,
      description: editDescription.trim() || null,
      type: editType,
      status: editStatus,
      metadata: updatedMetadata,
    })
    cancelEdit()
  }

  async function deleteBeat(beat: StoryBeat) {
    await story.deleteStoryBeat(beat.id)
  }

  type LucideIcon = typeof Circle

  const STATUS_CONFIG: Record<
    StoryBeat['status'],
    { icon: LucideIcon; color: string; bgColor: string }
  > = {
    pending: {
      icon: Circle,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted/50 ring-muted-foreground/30',
    },
    active: {
      icon: Target,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10 ring-amber-500/50',
    },
    completed: {
      icon: CheckCircle,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10 ring-green-500/40',
    },
    failed: {
      icon: XCircle,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10 ring-destructive/40',
    },
  }

  function getStatusConfig(status: StoryBeat['status']) {
    return STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  }

  function getTypeLabel(type: string) {
    switch (type) {
      case 'milestone':
        return 'Milestone'
      case 'quest':
        return 'Quest'
      case 'revelation':
        return 'Revelation'
      case 'event':
        return 'Event'
      case 'plot_point':
        return 'Plot Point'
      default:
        return type
    }
  }
</script>

<div class="flex flex-col gap-1 pb-12">
  <!-- Header -->
  <div class="mb-2 flex items-center justify-between">
    <h3 class="text-foreground text-xl font-bold tracking-tight">Story Beats</h3>
    <Button
      variant="text"
      size="icon"
      class="text-muted-foreground hover:text-foreground h-6 w-6"
      onclick={() => (showAddForm = !showAddForm)}
      title="Add story beat"
    >
      <Plus class="h-6! w-6!" />
    </Button>
  </div>

  <!-- Add Form -->
  {#if showAddForm}
    <div class="border-border bg-card mb-2 rounded-lg border p-3 shadow-sm">
      <div class="space-y-3">
        <Input type="text" bind:value={newTitle} placeholder="Title" class="h-8 text-sm" />

        <Select.Root type="single" bind:value={newType}>
          <Select.Trigger class="h-8 w-full text-xs">
            <div class="flex items-center gap-2 overflow-hidden">
              <span class="truncate">{getTypeLabel(newType)}</span>
            </div>
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="quest" label="Quest" />
            <Select.Item value="milestone" label="Milestone" />
            <Select.Item value="revelation" label="Revelation" />
            <Select.Item value="event" label="Event" />
            <Select.Item value="plot_point" label="Plot Point" />
          </Select.Content>
        </Select.Root>

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
        <Button size="sm" class="h-7" onclick={addBeat} disabled={!newTitle.trim()}>Add</Button>
      </div>
    </div>
  {/if}

  <!-- Active Quests -->
  {#if story.pendingQuests.length > 0}
    <div class="mb-4 flex flex-col gap-2">
      <h4 class="text-muted-foreground pl-1 text-xs font-semibold tracking-wider uppercase">
        Active
      </h4>
      {#each story.pendingQuests as beat (beat.id)}
        {@const statusConfig = getStatusConfig(beat.status)}
        {@const isCollapsed = ui.isEntityCollapsed(beat.id)}
        {@const isEditing = editingId === beat.id}
        {@const description = beat.translatedDescription ?? beat.description}

        <div
          class={cn(
            'group bg-card rounded-lg border px-2.5 py-2 shadow-sm transition-all',
            isEditing && 'ring-primary/20 border-border ring-1',
            !isEditing && beat.status === 'pending' && 'border-muted-foreground/20',
            !isEditing && beat.status === 'active' && 'border-amber-500/40',
          )}
        >
          {#if isEditing}
            <!-- EDIT MODE -->
            <div class="space-y-3">
              <div class="mb-2 flex items-center justify-between">
                <h4 class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Editing Beat
                </h4>
                <Button variant="text" size="icon" class="h-6 w-6" onclick={cancelEdit}>
                  <X class="h-4 w-4" />
                </Button>
              </div>

              <div class="space-y-2">
                <div class="space-y-1">
                  <Label class="text-xs">Title</Label>
                  <Input
                    type="text"
                    bind:value={editTitle}
                    placeholder="Title"
                    class="h-8 text-sm"
                  />
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <div class="space-y-1">
                    <Label class="text-xs">Type</Label>
                    <Select.Root type="single" bind:value={editType}>
                      <Select.Trigger class="h-8 w-full text-xs">
                        <div class="flex items-center gap-2 overflow-hidden">
                          <span class="truncate">{getTypeLabel(editType)}</span>
                        </div>
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="quest" label="Quest" />
                        <Select.Item value="milestone" label="Milestone" />
                        <Select.Item value="revelation" label="Revelation" />
                        <Select.Item value="event" label="Event" />
                        <Select.Item value="plot_point" label="Plot Point" />
                      </Select.Content>
                    </Select.Root>
                  </div>
                  <div class="space-y-1">
                    <Label class="text-xs">Status</Label>
                    <Select.Root type="single" bind:value={editStatus}>
                      <Select.Trigger class="h-8 w-full text-xs">
                        <div class="flex items-center gap-2 overflow-hidden">
                          <span class="truncate capitalize">{editStatus}</span>
                        </div>
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="pending" label="Pending" />
                        <Select.Item value="active" label="Active" />
                        <Select.Item value="completed" label="Completed" />
                        <Select.Item value="failed" label="Failed" />
                      </Select.Content>
                    </Select.Root>
                  </div>
                </div>

                <div class="space-y-1">
                  <Label class="text-xs">Description</Label>
                  <Textarea
                    bind:value={editDescription}
                    placeholder="Description"
                    class="min-h-[60px] resize-none text-xs"
                  />
                </div>

                <!-- Runtime Variables (Edit - Active) -->
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
              </div>

              <div class="border-border flex justify-end gap-2 border-t pt-2">
                <Button variant="text" size="sm" class="h-7 text-xs" onclick={cancelEdit}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  class="h-7 px-4 text-xs"
                  onclick={() => saveEdit(beat)}
                  disabled={!editTitle.trim()}
                >
                  <Save class="mr-1.5 h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
            </div>
          {:else}
            <!-- DISPLAY MODE -->
            <div class="flex items-start gap-2.5">
              <!-- Status Icon -->
              <div
                class={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2',
                  statusConfig.bgColor,
                )}
              >
                <statusConfig.icon class={cn('h-3.5 w-3.5', statusConfig.color)} />
              </div>

              <!-- Name & Badge -->
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="text-foreground text-sm leading-tight font-medium">
                  {beat.translatedTitle ?? beat.title}
                </span>
                <Badge
                  variant="secondary"
                  class="text-muted-foreground h-4 w-fit px-1.5 py-0 text-[10px] font-normal"
                >
                  {getTypeLabel(beat.type)}
                </Badge>
              </div>
            </div>

            <!-- Expanded Details -->
            {#if !isCollapsed && description}
              <div class="text-muted-foreground mt-2 text-xs">
                <p class="leading-relaxed whitespace-pre-wrap">{description}</p>
              </div>

              <!-- Runtime Variables (Non-pinned, collapsible - Active) -->
              {#if runtimeVarDefs.length > 0}
                <RuntimeVariableDisplay
                  definitions={runtimeVarDefs}
                  values={beat.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                  pinnedOnly={false}
                  class="mt-1.5"
                />
              {/if}
            {/if}

            <!-- Runtime Variables (Pinned, always visible - Active) -->
            {#if runtimeVarDefs.length > 0}
              <RuntimeVariableDisplay
                definitions={runtimeVarDefs}
                values={beat.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                pinnedOnly={true}
                class={isCollapsed ? 'mt-2' : 'mt-1'}
              />
            {/if}

            <!-- Footer Actions -->
            <div class="mt-2 flex items-center justify-between">
              <div class="-ml-1.5 flex items-center">
                {#if description}
                  <Button
                    variant="text"
                    size="icon"
                    class="text-muted-foreground hover:text-foreground h-6 w-6"
                    onclick={() => toggleCollapse(beat.id)}
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

              <IconRow class="-mr-1.5" onDelete={() => deleteBeat(beat)} showDelete={true}>
                <Button
                  variant="text"
                  size="icon"
                  class="text-muted-foreground hover:text-foreground h-6 w-6"
                  onclick={() => startEdit(beat)}
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

  <!-- History / Empty State -->
  {#if story.storyBeats.length === 0 && story.pendingQuests.length === 0}
    <div
      class="border-border bg-muted/20 flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center"
    >
      <div class="bg-muted mb-3 rounded-full p-3">
        <Target class="text-muted-foreground h-6 w-6" />
      </div>
      <p class="text-muted-foreground text-sm">No story beats yet</p>
      <Button
        variant="text"
        size="sm"
        class="text-primary hover:text-primary/80 mt-1 h-auto gap-1.5 text-xs"
        onclick={() => (showAddForm = true)}
      >
        <Plus class="h-3.5 w-3.5" />
        Add your first beat
      </Button>
    </div>
  {:else}
    {@const completedBeats = story.storyBeats.filter(
      (b) => b.status === 'completed' || b.status === 'failed',
    )}

    {#if completedBeats.length > 0}
      <div class="flex flex-col gap-2">
        <h4 class="text-muted-foreground pl-1 text-xs font-semibold tracking-wider uppercase">
          History
        </h4>
        {#each completedBeats as beat (beat.id)}
          {@const statusConfig = getStatusConfig(beat.status)}
          {@const isCollapsed = ui.isEntityCollapsed(beat.id)}
          {@const isEditing = editingId === beat.id}
          {@const description = beat.translatedDescription ?? beat.description}

          <div
            class={cn(
              'group bg-card/50 rounded-lg border px-2.5 py-2 shadow-sm transition-all',
              isEditing && 'ring-primary/20 border-border opacity-100 ring-1',
              !isEditing && 'opacity-80 hover:opacity-100',
              !isEditing && beat.status === 'completed' && 'border-green-500/30',
              !isEditing && beat.status === 'failed' && 'border-destructive/30',
            )}
          >
            {#if isEditing}
              <!-- EDIT MODE -->
              <div class="space-y-3">
                <div class="mb-2 flex items-center justify-between">
                  <h4 class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    Editing Beat
                  </h4>
                  <Button variant="text" size="icon" class="h-6 w-6" onclick={cancelEdit}>
                    <X class="h-4 w-4" />
                  </Button>
                </div>

                <div class="space-y-2">
                  <div class="space-y-1">
                    <Label class="text-xs">Title</Label>
                    <Input
                      type="text"
                      bind:value={editTitle}
                      placeholder="Title"
                      class="h-8 text-sm"
                    />
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <div class="space-y-1">
                      <Label class="text-xs">Type</Label>
                      <Select.Root type="single" bind:value={editType}>
                        <Select.Trigger class="h-8 w-full text-xs">
                          <div class="flex items-center gap-2 overflow-hidden">
                            <span class="truncate">{getTypeLabel(editType)}</span>
                          </div>
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="quest" label="Quest" />
                          <Select.Item value="milestone" label="Milestone" />
                          <Select.Item value="revelation" label="Revelation" />
                          <Select.Item value="event" label="Event" />
                          <Select.Item value="plot_point" label="Plot Point" />
                        </Select.Content>
                      </Select.Root>
                    </div>
                    <div class="space-y-1">
                      <Label class="text-xs">Status</Label>
                      <Select.Root type="single" bind:value={editStatus}>
                        <Select.Trigger class="h-8 w-full text-xs">
                          <div class="flex items-center gap-2 overflow-hidden">
                            <span class="truncate capitalize">{editStatus}</span>
                          </div>
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="pending" label="Pending" />
                          <Select.Item value="active" label="Active" />
                          <Select.Item value="completed" label="Completed" />
                          <Select.Item value="failed" label="Failed" />
                        </Select.Content>
                      </Select.Root>
                    </div>
                  </div>

                  <div class="space-y-1">
                    <Label class="text-xs">Description</Label>
                    <Textarea
                      bind:value={editDescription}
                      placeholder="Description"
                      class="min-h-[60px] resize-none text-xs"
                    />
                  </div>

                  <!-- Runtime Variables (Edit - History) -->
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
                </div>

                <div class="border-border flex justify-end gap-2 border-t pt-2">
                  <Button variant="text" size="sm" class="h-7 text-xs" onclick={cancelEdit}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    class="h-7 px-4 text-xs"
                    onclick={() => saveEdit(beat)}
                    disabled={!editTitle.trim()}
                  >
                    <Save class="mr-1.5 h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              </div>
            {:else}
              <!-- DISPLAY MODE -->
              <div class="flex items-start gap-2.5">
                <!-- Status Icon -->
                <div
                  class={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2',
                    statusConfig.bgColor,
                  )}
                >
                  <statusConfig.icon class={cn('h-3.5 w-3.5', statusConfig.color)} />
                </div>

                <!-- Name & Badge -->
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    class={cn(
                      'text-muted-foreground text-sm leading-tight font-medium',
                      beat.status === 'completed' && 'line-through decoration-green-500/50',
                      beat.status === 'failed' && 'decoration-destructive/50 line-through',
                    )}
                  >
                    {beat.translatedTitle ?? beat.title}
                  </span>
                  <Badge
                    variant="secondary"
                    class="text-muted-foreground h-4 w-fit px-1.5 py-0 text-[10px] font-normal"
                  >
                    {getTypeLabel(beat.type)}
                  </Badge>
                </div>
              </div>

              <!-- Expanded Details -->
              {#if !isCollapsed && description}
                <div class="text-muted-foreground mt-2 text-xs">
                  <p class="leading-relaxed whitespace-pre-wrap">{description}</p>
                </div>

                <!-- Runtime Variables (Non-pinned, collapsible - History) -->
                {#if runtimeVarDefs.length > 0}
                  <RuntimeVariableDisplay
                    definitions={runtimeVarDefs}
                    values={beat.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                    pinnedOnly={false}
                    class="mt-1.5"
                  />
                {/if}
              {/if}

              <!-- Runtime Variables (Pinned, always visible - History) -->
              {#if runtimeVarDefs.length > 0}
                <RuntimeVariableDisplay
                  definitions={runtimeVarDefs}
                  values={beat.metadata?.runtimeVars as RuntimeVarsMap | undefined}
                  pinnedOnly={true}
                  class={isCollapsed ? 'mt-2' : 'mt-1'}
                />
              {/if}

              <!-- Footer Actions -->
              <div class="mt-2 flex items-center justify-between">
                <div class="-ml-1.5 flex items-center">
                  {#if description}
                    <Button
                      variant="text"
                      size="icon"
                      class="text-muted-foreground hover:text-foreground h-6 w-6"
                      onclick={() => toggleCollapse(beat.id)}
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

                <IconRow class="-mr-1.5" onDelete={() => deleteBeat(beat)} showDelete={true}>
                  <Button
                    variant="text"
                    size="icon"
                    class="text-muted-foreground hover:text-foreground h-6 w-6"
                    onclick={() => startEdit(beat)}
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
  {/if}
</div>
