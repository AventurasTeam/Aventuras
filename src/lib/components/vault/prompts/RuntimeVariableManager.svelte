<script lang="ts">
  import type {
    RuntimeVariable,
    RuntimeVariableType,
    RuntimeEntityType,
  } from '$lib/services/packs/types'
  import { database } from '$lib/services/database'
  import RuntimeVariableCard from './RuntimeVariableCard.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Plus, Activity, AlertTriangle } from 'lucide-svelte'

  interface Props {
    packId: string
    runtimeVariables: RuntimeVariable[]
    onVariablesChanged: () => void
  }

  let { packId, runtimeVariables, onVariablesChanged }: Props = $props()

  // Track newly created variable ID so its card renders expanded
  let newlyCreatedId = $state<string | null>(null)

  // Entity count cache for delete confirmations (keyed by variable id)
  let entityCounts = $state<Record<string, number>>({})

  const ENTITY_TYPE_ORDER: RuntimeEntityType[] = ['character', 'location', 'item', 'story_beat']

  const ENTITY_TYPE_LABELS: Record<RuntimeEntityType, string> = {
    character: 'Characters',
    location: 'Locations',
    item: 'Items',
    story_beat: 'Story Beats',
  }

  // Group variables by entity type
  let grouped = $derived(() => {
    const groups: Record<RuntimeEntityType, RuntimeVariable[]> = {
      character: [],
      location: [],
      item: [],
      story_beat: [],
    }
    for (const v of runtimeVariables) {
      groups[v.entityType].push(v)
    }
    // Sort by sortOrder within each group
    for (const key of ENTITY_TYPE_ORDER) {
      groups[key].sort((a, b) => a.sortOrder - b.sortOrder)
    }
    return groups
  })

  // Compute entity type counts for soft warning
  let entityTypeCounts = $derived(() => {
    const counts: Record<RuntimeEntityType, number> = {
      character: 0,
      location: 0,
      item: 0,
      story_beat: 0,
    }
    for (const v of runtimeVariables) {
      counts[v.entityType]++
    }
    return counts
  })

  // Active entity types (those with at least one variable)
  let activeEntityTypes = $derived(ENTITY_TYPE_ORDER.filter((et) => grouped()[et].length > 0))

  function nextVariableName(): string {
    let max = 0
    for (const v of runtimeVariables) {
      const match = v.variableName.match(/^new_variable(?:_(\d+))?$/)
      if (match) max = Math.max(max, Number(match[1] ?? 1))
    }
    return max === 0 ? 'new_variable' : `new_variable_${max + 1}`
  }

  async function handleAddVariable() {
    try {
      const name = nextVariableName()
      const created = await database.createRuntimeVariable(packId, {
        entityType: 'character',
        variableName: name,
        displayName: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        variableType: 'text',
        color: '#6366f1',
        pinned: false,
        sortOrder: runtimeVariables.length,
      })
      newlyCreatedId = created.id
      onVariablesChanged()
    } catch (error) {
      console.error('[RuntimeVariableManager] Failed to create variable:', error)
    }
  }

  async function handleUpdateVariable(variable: RuntimeVariable) {
    try {
      // Use null (not undefined) for optional fields so the database layer
      // actually clears them — undefined means "skip this field" to updateRuntimeVariable.
      await database.updateRuntimeVariable(variable.id, {
        displayName: variable.displayName,
        description: variable.description ?? null,
        entityType: variable.entityType,
        variableType: variable.variableType,
        defaultValue: variable.defaultValue ?? null,
        minValue: variable.minValue ?? null,
        maxValue: variable.maxValue ?? null,
        enumOptions: variable.enumOptions ?? null,
        color: variable.color,
        icon: variable.icon ?? null,
        pinned: variable.pinned,
        sortOrder: variable.sortOrder,
      })
      onVariablesChanged()
    } catch (error) {
      console.error('[RuntimeVariableManager] Failed to update variable:', error)
    }
  }

  async function handleDeleteVariable(variable: RuntimeVariable) {
    try {
      await database.withTransaction(async () => {
        await database.deleteRuntimeVariable(variable.id)
        await database.clearRuntimeVarFromEntities(packId, variable.id)
      })
      onVariablesChanged()
    } catch (error) {
      console.error('[RuntimeVariableManager] Failed to delete variable:', error)
    }
  }

  async function handleRenameVariable(
    variableId: string,
    oldVariableName: string,
    newVariableName: string,
  ) {
    try {
      await database.withTransaction(async () => {
        await database.updateRuntimeVariable(variableId, { variableName: newVariableName })
        await database.renameRuntimeVarInEntities(packId, variableId, newVariableName)
      })
      onVariablesChanged()
    } catch (error) {
      console.error('[RuntimeVariableManager] Failed to rename variable:', error)
    }
  }

  async function handleTypeChange(variable: RuntimeVariable, newType: RuntimeVariableType) {
    try {
      await database.withTransaction(async () => {
        await database.clearRuntimeVarFromEntities(packId, variable.id)
        await database.updateRuntimeVariable(variable.id, {
          variableType: newType,
          defaultValue: undefined,
          minValue: undefined,
          maxValue: undefined,
          enumOptions: undefined,
        })
      })
      onVariablesChanged()
    } catch (error) {
      console.error('[RuntimeVariableManager] Failed to change variable type:', error)
    }
  }

  // Fetch entity count for a variable (for delete confirmation)
  async function loadEntityCount(variableId: string) {
    if (entityCounts[variableId] !== undefined) return
    try {
      const count = await database.countEntitiesWithRuntimeVar(packId, variableId)
      entityCounts = { ...entityCounts, [variableId]: count }
    } catch (error) {
      console.error('[RuntimeVariableManager] Failed to count entities:', error)
    }
  }

  async function moveVariable(
    entityType: RuntimeEntityType,
    index: number,
    direction: 'up' | 'down',
  ) {
    const group = grouped()[entityType]
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= group.length) return

    const tempOrder = group[index].sortOrder
    group[index].sortOrder = group[newIndex].sortOrder
    group[newIndex].sortOrder = tempOrder

    await database.withTransaction(async () => {
      await database.updateRuntimeVariable(group[index].id, { sortOrder: group[index].sortOrder })
      await database.updateRuntimeVariable(group[newIndex].id, {
        sortOrder: group[newIndex].sortOrder,
      })
    })
    onVariablesChanged()
  }

  // Load entity counts for all variables
  $effect(() => {
    for (const v of runtimeVariables) {
      loadEntityCount(v.id)
    }
  })
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between border-b px-4 py-3">
    <h3 class="text-sm font-semibold">Runtime Variables</h3>
    <Button variant="outline" size="sm" class="h-7 gap-1 text-xs" onclick={handleAddVariable}>
      <Plus class="h-3 w-3" />
      Add Variable
    </Button>
  </div>

  <!-- Variable List -->
  <div class="flex-1 overflow-y-auto p-4">
    {#if runtimeVariables.length === 0}
      <!-- Empty state -->
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <Activity class="text-muted-foreground mb-3 h-10 w-10 opacity-50" />
        <p class="text-muted-foreground text-sm font-medium">No runtime variables defined</p>
        <p class="text-muted-foreground mt-1 max-w-sm text-xs">
          Define variables that the LLM will populate on characters, locations, items, and story
          beats. For example, a "mood" variable for characters or "danger_level" for locations.
        </p>
        <Button variant="outline" size="sm" class="mt-4 gap-1" onclick={handleAddVariable}>
          <Plus class="h-3.5 w-3.5" />
          Add Variable
        </Button>
      </div>
    {:else}
      <div class="space-y-5">
        {#each activeEntityTypes as entityType (entityType)}
          <!-- Entity type section -->
          <div>
            <div class="mb-2 flex items-center gap-2">
              <h4 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {ENTITY_TYPE_LABELS[entityType]}
              </h4>
              <span class="text-muted-foreground text-xs">
                ({grouped()[entityType].length})
              </span>
            </div>

            <!-- Soft warning for 10+ variables -->
            {#if entityTypeCounts()[entityType] >= 10}
              <div
                class="text-muted-foreground mb-2 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs"
              >
                <AlertTriangle class="h-3 w-3 shrink-0" />
                <span>
                  10+ variables for {ENTITY_TYPE_LABELS[entityType].toLowerCase()} may increase extraction
                  cost and reduce accuracy.
                </span>
              </div>
            {/if}

            <div class="space-y-2">
              {#each grouped()[entityType] as variable, i (variable.id)}
                <RuntimeVariableCard
                  {variable}
                  onUpdate={handleUpdateVariable}
                  onDelete={() => handleDeleteVariable(variable)}
                  onRename={(oldName, newName) =>
                    handleRenameVariable(variable.id, oldName, newName)}
                  onTypeChange={handleTypeChange}
                  initialExpanded={variable.id === newlyCreatedId}
                  entityTypeWarningCount={entityCounts[variable.id] ?? 0}
                  onMoveUp={i > 0 ? () => moveVariable(entityType, i, 'up') : undefined}
                  onMoveDown={i < grouped()[entityType].length - 1
                    ? () => moveVariable(entityType, i, 'down')
                    : undefined}
                />
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
