<script lang="ts">
  import type { CustomVariable } from '$lib/services/packs/types'
  import { database } from '$lib/services/database'
  import VariableCard from './VariableCard.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Plus, Variable } from 'lucide-svelte'

  interface Props {
    packId: string
    variables: CustomVariable[]
    onVariablesChanged: () => void
  }

  let { packId, variables, onVariablesChanged }: Props = $props()

  // Track newly created variable ID so its card renders expanded
  let newlyCreatedId = $state<string | null>(null)

  function nextVariableName(): string {
    const existing = new Set(variables.map((v) => v.variableName))
    if (!existing.has('new_variable')) return 'new_variable'
    for (let i = 2; ; i++) {
      const name = `new_variable_${i}`
      if (!existing.has(name)) return name
    }
  }

  async function handleAddVariable() {
    try {
      const name = nextVariableName()
      const created = await database.createPackVariable(packId, {
        variableName: name,
        displayName: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        variableType: 'text',
        isRequired: false,
        sortOrder: variables.length,
      })
      newlyCreatedId = created.id
      onVariablesChanged()
    } catch (error) {
      console.error('[VariableManager] Failed to create variable:', error)
    }
  }

  async function handleUpdateVariable(variable: CustomVariable) {
    try {
      await database.updatePackVariable(variable.id, {
        variableName: variable.variableName,
        displayName: variable.displayName,
        description: variable.description,
        variableType: variable.variableType,
        isRequired: variable.isRequired,
        sortOrder: variable.sortOrder,
        defaultValue: variable.defaultValue,
        enumOptions: variable.enumOptions,
      })
      onVariablesChanged()
    } catch (error) {
      console.error('[VariableManager] Failed to update variable:', error)
    }
  }

  async function handleDeleteVariable(id: string) {
    try {
      await database.deletePackVariable(id)
      onVariablesChanged()
    } catch (error) {
      console.error('[VariableManager] Failed to delete variable:', error)
    }
  }
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between border-b px-4 py-3">
    <h3 class="text-sm font-semibold">Custom Variables</h3>
    <Button variant="outline" size="sm" class="h-7 gap-1 text-xs" onclick={handleAddVariable}>
      <Plus class="h-3 w-3" />
      Add Variable
    </Button>
  </div>

  <!-- Variable List -->
  <div class="flex-1 overflow-y-auto p-4">
    {#if variables.length === 0}
      <!-- Empty state -->
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <Variable class="text-muted-foreground mb-3 h-10 w-10 opacity-50" />
        <p class="text-muted-foreground text-sm font-medium">
          No custom variables defined for this pack.
        </p>
        <p class="text-muted-foreground mt-1 max-w-sm text-xs">
          Custom variables let you add configurable values to your templates. Use <code
            class="bg-muted rounded px-1 py-0.5 font-mono">{`{{ variable_name }}`}</code
          > syntax in templates.
        </p>
        <Button variant="outline" size="sm" class="mt-4 gap-1" onclick={handleAddVariable}>
          <Plus class="h-3.5 w-3.5" />
          Add Variable
        </Button>
      </div>
    {:else}
      <div class="space-y-3">
        {#each variables as variable (variable.id)}
          <VariableCard
            {variable}
            onUpdate={handleUpdateVariable}
            onDelete={handleDeleteVariable}
            initialExpanded={variable.id === newlyCreatedId}
          />
        {/each}
      </div>
    {/if}
  </div>
</div>
