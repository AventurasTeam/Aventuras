<script lang="ts">
  import type {
    RuntimeVariable,
    RuntimeVariableType,
    RuntimeEntityType,
    EnumOption,
  } from '$lib/services/packs/types'
  import { Button } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Separator } from '$lib/components/ui/separator'
  import * as Select from '$lib/components/ui/select'
  import IconPicker from './IconPicker.svelte'
  import ColorPicker from './ColorPicker.svelte'
  import {
    ChevronDown,
    ChevronUp,
    Trash2,
    Plus,
    ArrowUp,
    ArrowDown,
    X,
    AlertTriangle,
    Save,
    Check,
    Pin,
  } from 'lucide-svelte'

  // Icon map for rendering selected icon in collapsed state
  import {
    Icon,
    Heart,
    Shield,
    Sword,
    Star,
    Flame,
    Zap,
    Crown,
    Eye,
    Brain,
    Target,
    Compass,
    Skull,
    Gem,
    Key,
    Lock,
    Map,
    Mountain,
    Droplet,
    Wind,
    Sun,
    Moon,
    Clock,
    Activity,
    Award,
    Battery,
    Bookmark,
    CircleDot,
    Crosshair,
    Feather,
    Flag,
    Gift,
    Globe,
    Hammer,
    Lightbulb,
    Music,
    Palette,
    Scale,
    Sparkles,
    Trophy,
    Wand2,
    Users,
    Gauge,
  } from 'lucide-svelte'

  const ICON_COMPONENTS: Record<string, typeof Icon> = {
    Heart,
    Shield,
    Sword,
    Star,
    Flame,
    Zap,
    Crown,
    Eye,
    Brain,
    Target,
    Compass,
    Skull,
    Gem,
    Key,
    Lock,
    Map,
    Mountain,
    Droplet,
    Wind,
    Sun,
    Moon,
    Clock,
    Activity,
    Award,
    Battery,
    Bookmark,
    CircleDot,
    Crosshair,
    Feather,
    Flag,
    Gift,
    Globe,
    Hammer,
    Lightbulb,
    Music,
    Palette,
    Scale,
    Sparkles,
    Trophy,
    Wand2,
    Users,
    Gauge,
  }

  interface Props {
    variable: RuntimeVariable
    onUpdate: (variable: RuntimeVariable) => void
    onDelete: () => void
    onRename: (oldVariableName: string, newVariableName: string) => void
    onTypeChange: (variable: RuntimeVariable, newType: RuntimeVariableType) => void
    initialExpanded?: boolean
    entityTypeWarningCount?: number
    onMoveUp?: () => void
    onMoveDown?: () => void
  }

  let {
    variable,
    onUpdate,
    onDelete,
    onRename,
    onTypeChange,
    initialExpanded = false,
    entityTypeWarningCount = 0,
    onMoveUp,
    onMoveDown,
  }: Props = $props()

  let expanded = $state(false)
  let editName = $state('')
  let editDisplayName = $state('')
  let editDescription = $state('')
  let editType = $state<RuntimeVariableType>('text')
  let editEntityType = $state<RuntimeEntityType>('character')
  let editDefault = $state('')
  let editMinValue = $state('')
  let editMaxValue = $state('')
  let editColor = $state('#6366f1')
  let editIcon = $state<string | undefined>(undefined)
  let editEnumOptions = $state<EnumOption[]>([])
  let editPinned = $state(false)
  let showDeleteConfirm = $state(false)
  let showTypeChangeConfirm = $state(false)
  let pendingType = $state<RuntimeVariableType | null>(null)
  let lastVariableId = ''
  let saveFlash = $state(false)

  // Sync edit state from variable prop when variable identity changes
  $effect.pre(() => {
    if (variable.id !== lastVariableId) {
      lastVariableId = variable.id
      syncFromVariable()
      expanded = initialExpanded
      showDeleteConfirm = false
      showTypeChangeConfirm = false
      pendingType = null
    }
  })

  function syncFromVariable() {
    editName = variable.variableName
    editDisplayName = variable.displayName
    editDescription = variable.description ?? ''
    editType = variable.variableType
    editEntityType = variable.entityType
    editDefault = variable.defaultValue ?? ''
    editMinValue = variable.minValue !== undefined ? String(variable.minValue) : ''
    editMaxValue = variable.maxValue !== undefined ? String(variable.maxValue) : ''
    editColor = variable.color
    editIcon = variable.icon
    editEnumOptions = variable.enumOptions
      ? structuredClone($state.snapshot(variable.enumOptions))
      : []
    editPinned = variable.pinned ?? false
  }

  const VARIABLE_NAME_REGEX = /^[a-z_][a-z0-9_]*$/

  let nameError = $derived(
    editName.length === 0
      ? 'Variable name is required'
      : !VARIABLE_NAME_REGEX.test(editName)
        ? 'Lowercase letters, numbers, and underscores only (e.g. my_variable)'
        : null,
  )

  const TYPE_LABELS: Record<RuntimeVariableType, string> = {
    text: 'Text',
    number: 'Number',
    enum: 'Enum',
  }

  const VARIABLE_TYPES: RuntimeVariableType[] = ['text', 'number', 'enum']

  const ENTITY_TYPE_LABELS: Record<RuntimeEntityType, string> = {
    character: 'Character',
    location: 'Location',
    item: 'Item',
    story_beat: 'Story Beat',
  }

  const ENTITY_TYPES: RuntimeEntityType[] = ['character', 'location', 'item', 'story_beat']

  let isDirty = $derived(
    editDisplayName !== variable.displayName ||
      (editDescription || '') !== (variable.description ?? '') ||
      editType !== variable.variableType ||
      editEntityType !== variable.entityType ||
      editDefault !== (variable.defaultValue ?? '') ||
      editColor !== variable.color ||
      editIcon !== variable.icon ||
      editMinValue !== (variable.minValue !== undefined ? String(variable.minValue) : '') ||
      editMaxValue !== (variable.maxValue !== undefined ? String(variable.maxValue) : '') ||
      JSON.stringify(editEnumOptions) !== JSON.stringify(variable.enumOptions ?? []) ||
      editPinned !== (variable.pinned ?? false),
  )

  function handleSave() {
    emitUpdate()
    saveFlash = true
    setTimeout(() => (saveFlash = false), 1500)
  }

  function handleToggle() {
    if (expanded) {
      // Collapse and revert
      syncFromVariable()
      showDeleteConfirm = false
      showTypeChangeConfirm = false
      pendingType = null
      expanded = false
    } else {
      expanded = true
    }
  }

  function enforceSnakeCase(val: string): string {
    return val
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
  }

  function handleNameInput(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value
    editName = enforceSnakeCase(raw)
  }

  function handleNameBlur() {
    if (nameError) return
    if (editName !== variable.variableName) {
      onRename(variable.variableName, editName)
    }
  }

  function emitUpdate() {
    const updated: RuntimeVariable = {
      ...variable,
      displayName: editDisplayName,
      description: editDescription || undefined,
      entityType: editEntityType,
      variableType: editType,
      defaultValue: editDefault || undefined,
      minValue: editType === 'number' && editMinValue !== '' ? Number(editMinValue) : undefined,
      maxValue: editType === 'number' && editMaxValue !== '' ? Number(editMaxValue) : undefined,
      color: editColor,
      icon: editIcon,
      pinned: editPinned,
      enumOptions: editType === 'enum' ? editEnumOptions : undefined,
    }
    onUpdate(updated)
  }

  function handleFieldBlur() {
    emitUpdate()
  }

  function handleTypeChange(newType: string) {
    const t = newType as RuntimeVariableType
    if (t === editType) return
    if (entityTypeWarningCount > 0) {
      // Show confirmation warning only when entities have values to clear
      pendingType = t
      showTypeChangeConfirm = true
    } else {
      // No entities have values, change directly
      editType = t
      onTypeChange(variable, t)
    }
  }

  function confirmTypeChange() {
    if (!pendingType) return
    editType = pendingType
    onTypeChange(variable, pendingType)
    showTypeChangeConfirm = false
    pendingType = null
  }

  function cancelTypeChange() {
    showTypeChangeConfirm = false
    pendingType = null
  }

  function handleEntityTypeChange(newType: string) {
    editEntityType = newType as RuntimeEntityType
    emitUpdate()
  }

  function handleColorChange(color: string) {
    editColor = color
    emitUpdate()
  }

  function handleIconSelect(iconName: string | undefined) {
    editIcon = iconName
    emitUpdate()
  }

  function addEnumOption() {
    editEnumOptions = [...editEnumOptions, { label: '', value: '' }]
  }

  function removeEnumOption(index: number) {
    editEnumOptions = editEnumOptions.filter((_, i) => i !== index)
    emitUpdate()
  }

  function moveEnumOption(index: number, direction: 'up' | 'down') {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= editEnumOptions.length) return
    const copy = [...editEnumOptions]
    const temp = copy[index]
    copy[index] = copy[newIndex]
    copy[newIndex] = temp
    editEnumOptions = copy
    emitUpdate()
  }

  function updateEnumOption(index: number, field: 'label' | 'value', val: string) {
    editEnumOptions = editEnumOptions.map((opt, i) =>
      i === index ? { ...opt, [field]: val } : opt,
    )
  }

  function handleEnumBlur() {
    emitUpdate()
  }

  let IconComponent = $derived(variable.icon ? ICON_COMPONENTS[variable.icon] : undefined)
</script>

<div class="border-border bg-card rounded-lg border">
  <!-- Collapsed View -->
  <div class="flex items-center">
    {#if onMoveUp || onMoveDown}
      <div class="flex shrink-0 flex-col border-r px-1">
        <Button variant="ghost" size="icon" class="h-5 w-5" disabled={!onMoveUp} onclick={onMoveUp}>
          <ArrowUp class="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-5 w-5"
          disabled={!onMoveDown}
          onclick={onMoveDown}
        >
          <ArrowDown class="h-3 w-3" />
        </Button>
      </div>
    {/if}
    <button
      type="button"
      class="hover:bg-accent/50 flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
      onclick={handleToggle}
    >
      <div class="flex min-w-0 flex-1 items-center gap-2.5">
        {#if IconComponent}
          <IconComponent class="h-4 w-4 shrink-0" style="color: {variable.color}" />
        {:else}
          <span class="shrink-0 text-sm font-medium" style="color: {variable.color}"
            >{variable.displayName}</span
          >
        {/if}

        <code
          class="text-muted-foreground bg-muted shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
        >
          {variable.variableName}
        </code>

        <Badge variant="outline" class="shrink-0 text-[10px]">
          {ENTITY_TYPE_LABELS[variable.entityType]} &middot; {TYPE_LABELS[variable.variableType]}
        </Badge>

        {#if variable.description}
          <span class="text-muted-foreground min-w-0 truncate text-xs italic">
            {variable.description.length > 40
              ? variable.description.slice(0, 40) + '...'
              : variable.description}
          </span>
        {/if}
      </div>
      {#if variable.pinned}
        <Pin class="text-muted-foreground h-3 w-3 shrink-0" />
      {/if}
      {#if expanded}
        <ChevronUp class="text-muted-foreground h-4 w-4 shrink-0" />
      {:else}
        <ChevronDown class="text-muted-foreground h-4 w-4 shrink-0" />
      {/if}
    </button>
  </div>

  <!-- Expanded Edit Form -->
  {#if expanded}
    <Separator />
    <div class="space-y-4 px-4 py-4">
      <!-- Variable Name -->
      <div class="space-y-1.5">
        <Label>Variable Name</Label>
        <Input
          value={editName}
          oninput={handleNameInput}
          onblur={handleNameBlur}
          placeholder="my_variable"
          class="font-mono text-sm"
        />
        {#if nameError}
          <p class="text-destructive text-xs">{nameError}</p>
        {/if}
      </div>

      <!-- Entity Type -->
      <div class="space-y-1.5">
        <Label>Entity Type</Label>
        <Select.Root type="single" value={editEntityType} onValueChange={handleEntityTypeChange}>
          <Select.Trigger class="h-9 w-full">
            {ENTITY_TYPE_LABELS[editEntityType]}
          </Select.Trigger>
          <Select.Content>
            {#each ENTITY_TYPES as etype (etype)}
              <Select.Item value={etype} label={ENTITY_TYPE_LABELS[etype]}>
                {ENTITY_TYPE_LABELS[etype]}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <!-- Variable Type -->
      <div class="space-y-1.5">
        <Label>Variable Type</Label>
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

        {#if showTypeChangeConfirm}
          <div
            class="bg-destructive/10 border-destructive/30 flex items-start gap-2 rounded-md border p-2"
          >
            <AlertTriangle class="text-destructive mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div class="flex-1 space-y-1.5">
              <p class="text-destructive text-xs">
                Changing type will clear all existing values for this variable. Continue?
              </p>
              <div class="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  class="h-6 px-2 text-xs"
                  onclick={confirmTypeChange}
                >
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-2 text-xs"
                  onclick={cancelTypeChange}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Description -->
      <div class="space-y-1.5">
        <Label>Description</Label>
        <Textarea
          bind:value={editDescription}
          onblur={handleFieldBlur}
          placeholder="Guidance for the LLM about what this variable represents"
          rows={2}
        />
      </div>

      <!-- Panel Label & Color -->
      <div class="space-y-1.5">
        <Label>Panel Label</Label>
        <p class="text-muted-foreground text-xs">What to show as the label on entity panels</p>
        <div class="flex gap-2">
          <Button
            variant={editIcon ? 'outline' : 'default'}
            size="sm"
            class="h-7 gap-1 text-xs"
            onclick={() => {
              editIcon = undefined
              emitUpdate()
            }}
          >
            Display Name
          </Button>
          <Button
            variant={editIcon ? 'default' : 'outline'}
            size="sm"
            class="h-7 gap-1 text-xs"
            onclick={() => {
              if (!editIcon) {
                editIcon = 'Star'
                emitUpdate()
              }
            }}
          >
            Icon
          </Button>
        </div>
        {#if editIcon}
          <div class="mt-1.5">
            <IconPicker value={editIcon} onSelect={handleIconSelect} />
          </div>
        {:else}
          <div class="mt-1.5">
            <Input
              bind:value={editDisplayName}
              onblur={handleFieldBlur}
              placeholder="My Variable"
            />
          </div>
        {/if}

        <div class="mt-2">
          <Label>Color</Label>
          <div class="mt-1">
            <ColorPicker value={editColor} onChange={handleColorChange} />
          </div>
        </div>
      </div>

      <!-- Default Value -->
      <div class="space-y-1.5">
        <Label>Default Value</Label>
        <p class="text-muted-foreground text-xs">
          If set, the variable is optional for the LLM to fill
        </p>
        {#if editType === 'text'}
          <Input
            bind:value={editDefault}
            onblur={handleFieldBlur}
            placeholder="Default text value"
          />
        {:else if editType === 'number'}
          <Input
            type="number"
            bind:value={editDefault}
            onblur={handleFieldBlur}
            placeholder="Default number"
          />
        {:else if editType === 'enum'}
          {#if editEnumOptions.length > 0}
            <Select.Root
              type="single"
              value={editDefault}
              onValueChange={(v) => {
                editDefault = v
                emitUpdate()
              }}
            >
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

      <!-- Min/Max for number type -->
      {#if editType === 'number'}
        <div class="flex gap-4">
          <div class="flex-1 space-y-1.5">
            <Label>Min Value</Label>
            <Input
              type="number"
              bind:value={editMinValue}
              onblur={handleFieldBlur}
              placeholder="No minimum"
            />
          </div>
          <div class="flex-1 space-y-1.5">
            <Label>Max Value</Label>
            <Input
              type="number"
              bind:value={editMaxValue}
              onblur={handleFieldBlur}
              placeholder="No maximum"
            />
          </div>
        </div>
      {/if}

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
                  onblur={handleEnumBlur}
                  placeholder="Label"
                  class="h-8 flex-1 text-xs"
                />
                <Input
                  value={opt.value}
                  oninput={(e) => updateEnumOption(i, 'value', e.currentTarget.value)}
                  onblur={handleEnumBlur}
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

      <!-- Pinned -->
      <div class="flex items-center justify-between">
        <div class="space-y-0.5">
          <Label>Pinned</Label>
          <p class="text-muted-foreground text-xs">
            Always visible on entity panels, even when collapsed
          </p>
        </div>
        <Button
          variant={editPinned ? 'default' : 'outline'}
          size="sm"
          class="h-7 gap-1 text-xs"
          onclick={() => {
            editPinned = !editPinned
            emitUpdate()
          }}
        >
          <Pin class="h-3 w-3" />
          {editPinned ? 'Pinned' : 'Unpinned'}
        </Button>
      </div>

      <Separator />

      <!-- Footer: Save + Delete -->
      <div class="flex items-center justify-between">
        <div>
          {#if showDeleteConfirm}
            <div class="flex items-center gap-2">
              <span class="text-destructive text-xs">
                Delete this variable?
                {#if entityTypeWarningCount > 0}
                  ({entityTypeWarningCount}
                  {entityTypeWarningCount === 1 ? 'entity has' : 'entities have'} values)
                {/if}
              </span>
              <Button variant="destructive" size="sm" class="h-7 text-xs" onclick={onDelete}>
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
        </div>

        {#if saveFlash}
          <span class="text-muted-foreground flex items-center gap-1 text-xs">
            <Check class="h-3 w-3" />
            Saved
          </span>
        {:else}
          <Button
            variant={isDirty ? 'default' : 'outline'}
            size="sm"
            class="h-7 gap-1 text-xs"
            onclick={handleSave}
          >
            <Save class="h-3 w-3" />
            Save
          </Button>
        {/if}
      </div>
    </div>
  {/if}
</div>
