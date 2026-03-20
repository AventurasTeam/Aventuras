<script lang="ts">
  import type {
    Entry,
    EntryType,
    EntryInjectionMode,
    EntryState,
    AdventureEntryState,
    CreativeEntryState,
  } from '$lib/types'
  import { story } from '$lib/stores/story/index.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { ChevronDown, ChevronUp, Plus, X } from 'lucide-svelte'

  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Button } from '$lib/components/ui/button'
  import { Label } from '$lib/components/ui/label'
  import { Slider } from '$lib/components/ui/slider'
  import { Switch } from '$lib/components/ui/switch'
  import { Badge } from '$lib/components/ui/badge'
  import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select'
  import { RadioGroup, RadioGroupItem } from '$lib/components/ui/radio-group'
  import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
  } from '$lib/components/ui/collapsible'
  import { cn } from '$lib/utils/cn'

  interface Props {
    entry?: Entry | null
    onSave: (entry: Entry) => void
    onCancel: () => void
  }

  let { entry = null, onSave, onCancel }: Props = $props()

  // Form state
  let name = $derived(entry?.name ?? '')
  let type = $derived<EntryType>(entry?.type ?? 'character')
  let description = $derived(entry?.description ?? '')
  let hiddenInfo = $derived(entry?.hiddenInfo ?? '')
  let aliases = $derived<string[]>(entry?.aliases ?? [])
  let keywords = $derived<string[]>(entry?.injection.keywords ?? [])
  let injectionMode = $derived<EntryInjectionMode>(entry?.injection.mode ?? 'keyword')
  let priority = $derived(entry?.injection.priority ?? 50)
  let showHiddenInfo = $derived(!!entry?.hiddenInfo)
  let loreManagementBlacklisted = $derived(entry?.loreManagementBlacklisted ?? false)

  // Tag input states
  let newAlias = $state('')
  let newKeyword = $state('')

  let saving = $state(false)

  const entryTypes: Array<{ value: EntryType; label: string }> = [
    { value: 'character', label: 'Character' },
    { value: 'location', label: 'Location' },
    { value: 'item', label: 'Item' },
    { value: 'faction', label: 'Faction' },
    { value: 'concept', label: 'Concept' },
    { value: 'event', label: 'Event' },
  ]

  const injectionModes: Array<{ value: EntryInjectionMode; label: string; description: string }> = [
    { value: 'always', label: 'Always Active', description: 'Always included in every response' },
    { value: 'keyword', label: 'Automatic', description: 'Matched by keywords or AI relevance' },
    { value: 'never', label: 'Disabled', description: 'Not included in AI context' },
  ]

  function getDefaultState(entryType: EntryType): EntryState {
    switch (entryType) {
      case 'character':
        return {
          type: 'character',
          isPresent: false,
          lastSeenLocation: null,
          currentDisposition: null,
          relationship: { level: 0, status: 'unknown', history: [] },
          knownFacts: [],
          revealedSecrets: [],
        }
      case 'location':
        return {
          type: 'location',
          isCurrentLocation: false,
          visitCount: 0,
          changes: [],
          presentCharacters: [],
          presentItems: [],
        }
      case 'item':
        return {
          type: 'item',
          inInventory: false,
          currentLocation: null,
          condition: null,
          uses: [],
        }
      case 'faction':
        return {
          type: 'faction',
          playerStanding: 0,
          status: 'unknown',
          knownMembers: [],
        }
      case 'concept':
        return {
          type: 'concept',
          revealed: false,
          comprehensionLevel: 'unknown',
          relatedEntries: [],
        }
      case 'event':
        return {
          type: 'event',
          occurred: false,
          occurredAt: null,
          witnesses: [],
          consequences: [],
        }
    }
  }

  function getDefaultAdventureState(): AdventureEntryState {
    return { discovered: false, interactedWith: false, notes: [] }
  }

  function getDefaultCreativeState(): CreativeEntryState {
    return { arc: null, thematicRole: null, symbolism: null }
  }

  function addAlias() {
    const trimmed = newAlias.trim()
    if (trimmed && !aliases.includes(trimmed)) {
      aliases = [...aliases, trimmed]
    }
    newAlias = ''
  }

  function removeAlias(alias: string) {
    aliases = aliases.filter((a) => a !== alias)
  }

  function addKeyword() {
    const trimmed = newKeyword.trim()
    if (trimmed && !keywords.includes(trimmed)) {
      keywords = [...keywords, trimmed]
    }
    newKeyword = ''
  }

  function removeKeyword(keyword: string) {
    keywords = keywords.filter((k) => k !== keyword)
  }

  function handleAliasKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addAlias()
    }
  }

  function handleKeywordKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addKeyword()
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      ui.showToast('Name is required', 'error')
      return
    }

    saving = true

    try {
      const now = Date.now()
      const entryData: Entry = {
        id: entry?.id ?? crypto.randomUUID(),
        storyId: story.currentStory?.id ?? '',
        name: name.trim(),
        type,
        description: description.trim(),
        hiddenInfo: hiddenInfo.trim() || null,
        aliases,
        state: entry?.state?.type === type ? entry.state : getDefaultState(type),
        adventureState: entry?.adventureState ?? getDefaultAdventureState(),
        creativeState: entry?.creativeState ?? getDefaultCreativeState(),
        injection: {
          mode: injectionMode,
          keywords,
          priority,
        },
        firstMentioned: entry?.firstMentioned ?? null,
        lastMentioned: entry?.lastMentioned ?? null,
        mentionCount: entry?.mentionCount ?? 0,
        createdBy: entry?.createdBy ?? 'user',
        createdAt: entry?.createdAt ?? now,
        updatedAt: now,
        loreManagementBlacklisted,
        branchId: entry?.branchId ?? story.currentStory?.currentBranchId ?? null,
      }

      onSave(entryData)
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Failed to save entry', 'error')
    } finally {
      saving = false
    }
  }
</script>

<div class="space-y-6">
  <!-- Name -->
  <div class="space-y-2">
    <Label for="entry-name">
      Name <span class="text-red-500">*</span>
    </Label>
    <Input id="entry-name" type="text" bind:value={name} placeholder="Entry name" />
  </div>

  <!-- Type -->
  <div class="space-y-2">
    <Label for="entry-type">Type</Label>
    <Select type="single" value={type} onValueChange={(v) => (type = v as EntryType)}>
      <SelectTrigger id="entry-type">
        {entryTypes.find((t) => t.value === type)?.label ?? 'Select type'}
      </SelectTrigger>
      <SelectContent>
        {#each entryTypes as option ((option.value, option.label))}
          <SelectItem value={option.value}>{option.label}</SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>

  <!-- Description -->
  <div class="space-y-2">
    <Label for="entry-description">Description</Label>
    <Textarea
      id="entry-description"
      bind:value={description}
      placeholder="Describe this entry..."
      rows={4}
      class="resize-none"
    />
  </div>

  <!-- Aliases -->
  <div class="space-y-2">
    <Label>
      Aliases
      <span class="text-muted-foreground ml-1 text-xs font-normal">
        Alternative names for matching
      </span>
    </Label>
    <div class="mb-2 flex flex-wrap gap-2">
      {#each aliases as alias (alias)}
        <Badge variant="secondary" class="gap-1 pr-1">
          {alias}
          <button class="hover:bg-muted rounded-full p-0.5" onclick={() => removeAlias(alias)}>
            <X class="h-3 w-3" />
          </button>
        </Badge>
      {/each}
    </div>
    <div class="flex gap-2">
      <Input
        type="text"
        bind:value={newAlias}
        placeholder="Add alias..."
        class="flex-1"
        onkeydown={handleAliasKeydown}
      />
      <Button variant="outline" size="icon" onclick={addAlias} disabled={!newAlias.trim()}>
        <Plus class="h-4 w-4" />
      </Button>
    </div>
  </div>

  <!-- Keywords -->
  <div class="space-y-2">
    <Label>
      Keywords
      <span class="text-muted-foreground ml-1 text-xs font-normal">
        Trigger words for injection
      </span>
    </Label>
    <div class="mb-2 flex flex-wrap gap-2">
      {#each keywords as keyword (keyword)}
        <Badge
          variant="default"
          class="bg-primary/20 text-primary hover:bg-primary/30 gap-1 border-transparent pr-1"
        >
          {keyword}
          <button
            class="hover:bg-primary/20 text-primary rounded-full p-0.5"
            onclick={() => removeKeyword(keyword)}
          >
            <X class="h-3 w-3" />
          </button>
        </Badge>
      {/each}
    </div>
    <div class="flex gap-2">
      <Input
        type="text"
        bind:value={newKeyword}
        placeholder="Add keyword..."
        class="flex-1"
        onkeydown={handleKeywordKeydown}
      />
      <Button variant="outline" size="icon" onclick={addKeyword} disabled={!newKeyword.trim()}>
        <Plus class="h-4 w-4" />
      </Button>
    </div>
  </div>

  <!-- Context Inclusion Mode -->
  <div class="space-y-3">
    <Label>Context Inclusion</Label>
    <RadioGroup
      value={injectionMode}
      onValueChange={(v) => (injectionMode = v as EntryInjectionMode)}
      class="grid h-full grid-cols-1 gap-2 sm:grid-cols-3"
    >
      {#each injectionModes as mode ((mode.value, mode.label))}
        <div
          class={cn(
            'hover:bg-muted/50 flex h-full cursor-pointer items-start space-x-2 rounded-lg border transition-colors',
            injectionMode === mode.value && 'border-primary bg-primary/5',
          )}
        >
          <Label
            for={`mode-${mode.value}`}
            class="flex w-full cursor-pointer flex-col gap-1 font-normal"
          >
            <div class="flex flex-row items-center gap-3 p-3">
              <RadioGroupItem value={mode.value} id={`mode-${mode.value}`} class="mt-1" />
              <div class="flex flex-col">
                <span class="text-sm font-medium">{mode.label}</span>
                <span class="text-muted-foreground text-xs">{mode.description}</span>
              </div>
            </div>
          </Label>
        </div>
      {/each}
    </RadioGroup>

    {#if injectionMode === 'keyword'}
      <p class="text-muted-foreground mt-2 text-xs">
        Entry will be included when keywords/aliases match the story, or when the AI determines it's
        contextually relevant.
      </p>
    {/if}
  </div>

  <!-- Priority -->
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <Label>
        Priority
        <span class="text-muted-foreground ml-1 text-xs font-normal">
          Higher priority entries are injected first
        </span>
      </Label>
      <span class="w-8 text-right text-sm font-medium">{priority}</span>
    </div>
    <Slider
      value={priority}
      min={0}
      max={100}
      step={1}
      type="single"
      onValueChange={(val) => (priority = val)}
    />
  </div>

  <!-- Lore Management Blacklist -->
  <div class="bg-muted/30 flex items-center justify-between rounded-lg border p-3">
    <div class="space-y-0.5">
      <Label class="text-base">Hide from AI Lore Management</Label>
      <p class="text-muted-foreground text-xs">
        When enabled, the AI won't see or modify this entry during lore management
      </p>
    </div>
    <Switch bind:checked={loreManagementBlacklisted} />
  </div>

  <!-- Hidden Info (collapsible) -->
  <Collapsible bind:open={showHiddenInfo}>
    <CollapsibleTrigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          class="flex w-full justify-between px-0 hover:bg-transparent"
        >
          <span class="flex items-center gap-2 text-sm font-medium">
            Hidden Info
            <span class="text-muted-foreground text-xs font-normal"
              >(secrets the protagonist doesn't know)</span
            >
          </span>
          {#if showHiddenInfo}
            <ChevronUp class="text-muted-foreground h-4 w-4" />
          {:else}
            <ChevronDown class="text-muted-foreground h-4 w-4" />
          {/if}
        </Button>
      {/snippet}
    </CollapsibleTrigger>
    <CollapsibleContent>
      <Textarea
        bind:value={hiddenInfo}
        placeholder="Hidden information, revealed secrets, etc..."
        rows={3}
        class="mt-2 resize-none"
      />
    </CollapsibleContent>
  </Collapsible>

  <!-- Actions -->
  <div class="mt-4 flex gap-2 border-t pt-4">
    <Button variant="outline" class="flex-1" onclick={onCancel} disabled={saving}>Cancel</Button>
    <Button class="flex-1" onclick={handleSave} disabled={saving || !name.trim()}>
      {saving ? 'Saving...' : entry ? 'Save Changes' : 'Create Entry'}
    </Button>
  </div>
</div>
