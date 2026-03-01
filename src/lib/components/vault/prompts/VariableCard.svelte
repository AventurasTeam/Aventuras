<script lang="ts">
  import type { CustomVariable, CustomVariableType, EnumOption } from '$lib/services/packs/types'
  import { Button } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Switch } from '$lib/components/ui/switch'
  import { Separator } from '$lib/components/ui/separator'
  import * as Select from '$lib/components/ui/select'
  import { ChevronDown, ChevronUp, Trash2, Plus, ArrowUp, ArrowDown, X } from 'lucide-svelte'

  interface Props {
    variable: CustomVariable
    onUpdate: (variable: CustomVariable) => void
    onDelete: (id: string) => void
    initialExpanded?: boolean
  }

  let { variable, onUpdate, onDelete, initialExpanded = false }: Props = $props()

  let expanded = $state(false)
  let editName = $state('')
  let editDisplayName = $state('')
  let editDescription = $state('')
  let editType = $state<CustomVariableType>('text')
  let editDefault = $state('')
  let editEnumOptions = $state<EnumOption[]>([])
  let showDeleteConfirm = $state(false)
  let lastVariableId = ''

  // Sync edit state from variable prop only when the variable identity changes (different variable swapped in)
  $effect.pre(() => {
    if (variable.id !== lastVariableId) {
      lastVariableId = variable.id
      editName = variable.variableName
      editDisplayName = variable.displayName
      editDescription = variable.description ?? ''
      editType = variable.variableType
      editDefault = variable.defaultValue ?? ''
      editEnumOptions = variable.enumOptions
        ? structuredClone($state.snapshot(variable.enumOptions))
        : []
      expanded = initialExpanded
      showDeleteConfirm = false
    }
  })

  const VARIABLE_NAME_REGEX = /^[a-z_][a-z0-9_]*$/

  let nameError = $derived(
    editName.length === 0
      ? 'Variable name is required'
      : !VARIABLE_NAME_REGEX.test(editName)
        ? 'Lowercase letters, numbers, and underscores only (e.g. my_variable)'
        : null,
  )

  let canSave = $derived(!nameError && editName.length > 0 && editDisplayName.length > 0)

  const TYPE_LABELS: Record<CustomVariableType, string> = {
    text: 'Text',
    textarea: 'Textarea',
    number: 'Number',
    boolean: 'Boolean',
    enum: 'Enum',
  }

  const VARIABLE_TYPES: CustomVariableType[] = ['text', 'textarea', 'number', 'boolean', 'enum']

  function handleToggle() {
    if (expanded) {
      // Collapse and revert
      handleCancel()
    } else {
      expanded = true
    }
  }

  function handleSave() {
    if (!canSave) return
    const updated: CustomVariable = {
      ...variable,
      variableName: editName,
      displayName: editDisplayName,
      description: editDescription || undefined,
      variableType: editType,
      isRequired: variable.isRequired,
      defaultValue: editType === 'boolean' ? editDefault : editDefault || undefined,
      enumOptions: editType === 'enum' ? editEnumOptions : undefined,
    }
    onUpdate(updated)
    expanded = false
  }

  function handleCancel() {
    editName = variable.variableName
    editDisplayName = variable.displayName
    editDescription = variable.description ?? ''
    editType = variable.variableType
    editDefault = variable.defaultValue ?? ''
    editEnumOptions = variable.enumOptions
      ? structuredClone($state.snapshot(variable.enumOptions))
      : []
    showDeleteConfirm = false
    expanded = false
  }

  function handleTypeChange(newType: string) {
    editType = newType as CustomVariableType
    // Reset default value when switching types
    if (newType === 'boolean') {
      editDefault = 'false'
    } else if (newType === 'number') {
      editDefault = ''
    } else if (newType === 'enum') {
      editDefault = ''
      if (editEnumOptions.length === 0) {
        editEnumOptions = [{ label: '', value: '' }]
      }
    } else {
      editDefault = ''
    }
  }

  function addEnumOption() {
    editEnumOptions = [...editEnumOptions, { label: '', value: '' }]
  }

  function removeEnumOption(index: number) {
    editEnumOptions = editEnumOptions.filter((_, i) => i !== index)
  }

  function moveEnumOption(index: number, direction: 'up' | 'down') {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= editEnumOptions.length) return
    const copy = [...editEnumOptions]
    const temp = copy[index]
    copy[index] = copy[newIndex]
    copy[newIndex] = temp
    editEnumOptions = copy
  }

  function updateEnumOption(index: number, field: 'label' | 'value', val: string) {
    editEnumOptions = editEnumOptions.map((opt, i) =>
      i === index ? { ...opt, [field]: val } : opt,
    )
  }

  function truncate(str: string, len: number): string {
    if (str.length <= len) return str
    return str.slice(0, len) + '...'
  }
</script>

<div class="border-border bg-card rounded-lg border">
  <!-- Collapsed View -->
  <button
    type="button"
    class="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
    onclick={handleToggle}
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <code class="text-primary shrink-0 text-xs">{`{{ ${variable.variableName} }}`}</code>
      <Badge variant="outline" class="shrink-0 text-[10px]">
        {TYPE_LABELS[variable.variableType]}
      </Badge>
      {#if variable.description}
        <span class="text-muted-foreground min-w-0 truncate text-xs italic">
          {truncate(variable.description, 40)}
        </span>
      {/if}
      {#if variable.defaultValue}
        <span class="text-muted-foreground min-w-0 truncate text-xs">
          = {truncate(variable.defaultValue, 30)}
        </span>
      {/if}
    </div>
    {#if expanded}
      <ChevronUp class="text-muted-foreground h-4 w-4 shrink-0" />
    {:else}
      <ChevronDown class="text-muted-foreground h-4 w-4 shrink-0" />
    {/if}
  </button>

  <!-- Expanded Edit Form -->
  {#if expanded}
    <Separator />
    <div class="space-y-4 px-4 py-4">
      <!-- Variable Name -->
      <div class="space-y-2">
        <Label>Variable Name</Label>
        <Input bind:value={editName} placeholder="my_variable" class="font-mono text-sm" />
        {#if nameError}
          <p class="text-destructive text-xs">{nameError}</p>
        {/if}
      </div>

      <!-- Display Name -->
      <div class="space-y-1.5">
        <Label>Display Name</Label>
        <Input bind:value={editDisplayName} placeholder="My Variable" />
      </div>

      <!-- Description -->
      <div class="space-y-1.5">
        <Label>Description</Label>
        <Input bind:value={editDescription} placeholder="Help text shown in wizard" />
      </div>

      <!-- Type -->
      <div class="space-y-1.5">
        <Label>Type</Label>
        <Select.Root type="single" value={editType} onValueChange={handleTypeChange}>
          <Select.Trigger class="h-9 w-full">
            {TYPE_LABELS[editType]}
          </Select.Trigger>
          <Select.Content>
            {#each VARIABLE_TYPES as vtype (vtype)}
              <Select.Item value={vtype} label={TYPE_LABELS[vtype]}>
                {TYPE_LABELS[vtype]}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <!-- Default Value -->
      <div class="space-y-1.5">
        <Label>Default Value</Label>
        {#if editType === 'text'}
          <Input bind:value={editDefault} placeholder="Default text value" />
        {:else if editType === 'textarea'}
          <Textarea bind:value={editDefault} placeholder="Default text value" rows={3} />
        {:else if editType === 'number'}
          <Input type="number" bind:value={editDefault} placeholder="0" />
        {:else if editType === 'boolean'}
          <Switch
            checked={editDefault === 'true'}
            onCheckedChange={(v) => (editDefault = v ? 'true' : 'false')}
          />
        {:else if editType === 'enum'}
          {#if editEnumOptions.length > 0}
            <Select.Root type="single" value={editDefault} onValueChange={(v) => (editDefault = v)}>
              <Select.Trigger class="h-9 w-full">
                {editEnumOptions.find((o) => o.value === editDefault)?.label || 'Select default'}
              </Select.Trigger>
              <Select.Content>
                {#each editEnumOptions as opt (opt.value)}
                  {#if opt.value}
                    <Select.Item value={opt.value} label={opt.label || opt.value}>
                      {opt.label || opt.value}
                    </Select.Item>
                  {/if}
                {/each}
              </Select.Content>
            </Select.Root>
          {:else}
            <p class="text-muted-foreground text-xs">Add enum options first</p>
          {/if}
        {/if}
      </div>

      <!-- Enum Options Editor -->
      {#if editType === 'enum'}
        <div class="space-y-2">
          <Label>Enum Options</Label>
          <div class="space-y-2">
            {#each editEnumOptions as opt, i (i)}
              <div class="flex items-center gap-2">
                <Input
                  value={opt.label}
                  oninput={(e) => updateEnumOption(i, 'label', e.currentTarget.value)}
                  placeholder="Label"
                  class="h-8 flex-1 text-xs"
                />
                <Input
                  value={opt.value}
                  oninput={(e) => updateEnumOption(i, 'value', e.currentTarget.value)}
                  placeholder="Value"
                  class="h-8 flex-1 font-mono text-xs"
                />
                <div class="flex shrink-0 gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    disabled={i === 0}
                    onclick={() => moveEnumOption(i, 'up')}
                  >
                    <ArrowUp class="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    disabled={i === editEnumOptions.length - 1}
                    onclick={() => moveEnumOption(i, 'down')}
                  >
                    <ArrowDown class="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="text-destructive h-7 w-7"
                    onclick={() => removeEnumOption(i)}
                  >
                    <X class="h-3 w-3" />
                  </Button>
                </div>
              </div>
            {/each}
          </div>
          <Button variant="outline" size="sm" class="h-7 gap-1 text-xs" onclick={addEnumOption}>
            <Plus class="h-3 w-3" />
            Add Option
          </Button>
        </div>
      {/if}

      <Separator />

      <!-- Action Buttons -->
      <div class="flex items-center justify-between">
        {#if showDeleteConfirm}
          <div class="flex items-center gap-2">
            <span class="text-destructive text-xs">Delete this variable?</span>
            <Button
              variant="destructive"
              size="sm"
              class="h-7 text-xs"
              onclick={() => onDelete(variable.id)}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 text-xs"
              onclick={() => (showDeleteConfirm = false)}
            >
              Cancel
            </Button>
          </div>
        {:else}
          <Button
            variant="ghost"
            size="sm"
            class="text-destructive h-7 gap-1 text-xs"
            onclick={() => (showDeleteConfirm = true)}
          >
            <Trash2 class="h-3 w-3" />
            Delete
          </Button>
        {/if}

        <div class="flex gap-2">
          <Button variant="outline" size="sm" class="h-7 text-xs" onclick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" class="h-7 text-xs" disabled={!canSave} onclick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  {/if}
</div>
