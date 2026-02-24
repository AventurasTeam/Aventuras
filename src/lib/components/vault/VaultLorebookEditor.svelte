<script lang="ts">
  import type { VaultLorebook, VaultLorebookEntry, EntryType, EntryInjectionMode } from '$lib/types'
  import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
  import {
    X,
    Plus,
    Search,
    Trash2,
    Save,
    ArrowLeft,
    Users,
    MapPin,
    Box,
    Flag,
    Brain,
    Calendar,
    EyeOff,
    Bot,
    Settings,
    List,
    Maximize2,
    Minimize2,
  } from 'lucide-svelte'
  import InteractiveLorebookChat from './InteractiveLorebookChat.svelte'
  import TagInput from '$lib/components/tags/TagInput.svelte'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Label } from '$lib/components/ui/label'
  import * as Tabs from '$lib/components/ui/tabs'
  import { cn } from '$lib/utils/cn'
  import SelectTrigger from '../ui/select/select-trigger.svelte'
  import { Select, SelectContent, SelectItem } from '../ui/select'

  interface Props {
    lorebook: VaultLorebook
    onClose: () => void
  }

  let { lorebook, onClose }: Props = $props()

  // Local state for editing
  let name = $derived(lorebook.name)
  let description = $derived(lorebook.description ?? '')
  let tags = $derived<string[]>([...lorebook.tags])
  let entries = $derived<VaultLorebookEntry[]>(JSON.parse(JSON.stringify(lorebook.entries))) // Deep copy

  // UI State
  let searchQuery = $state('')
  let selectedIndex = $state<number | null>(null)
  let saving = $state(false)
  let error = $state<string | null>(null)
  let activeTab = $state('editor')
  let showInteractiveChat = $state(false)
  let isMaximized = $state(false)

  // Filtered entries
  const filteredEntries = $derived.by(() => {
    if (!searchQuery.trim()) return entries.map((e, i) => ({ entry: e, index: i }))
    const q = searchQuery.toLowerCase()
    return entries
      .map((e, i) => ({ entry: e, index: i }))
      .filter(
        ({ entry }) =>
          entry.name.toLowerCase().includes(q) ||
          entry.keywords.some((k) => k.toLowerCase().includes(q)),
      )
  })

  const selectedEntry = $derived(selectedIndex !== null ? entries[selectedIndex] : null)

  // Type options
  const entryTypes: EntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'event']
  const injectionModes: Array<{ value: EntryInjectionMode; label: string; description: string }> = [
    { value: 'always', label: 'Always Active', description: 'Always included in every response' },
    { value: 'keyword', label: 'Automatic', description: 'Matched by keywords or AI relevance' },
    { value: 'never', label: 'Disabled', description: 'Not included in AI context' },
  ]

  const typeIcons: Record<EntryType, any> = {
    character: Users,
    location: MapPin,
    item: Box,
    faction: Flag,
    concept: Brain,
    event: Calendar,
  }

  function handleSave() {
    if (!name.trim()) {
      error = 'Lorebook name is required'
      return
    }

    saving = true
    error = null

    // Update metadata entry breakdown
    const breakdown: Record<EntryType, number> = {
      character: 0,
      location: 0,
      item: 0,
      faction: 0,
      concept: 0,
      event: 0,
    }
    entries.forEach((e) => {
      if (breakdown[e.type] !== undefined) breakdown[e.type]++
    })

    lorebookVault
      .update(lorebook.id, {
        name,
        description: description || null,
        entries,
        tags,
        metadata: {
          ...lorebook.metadata,
          format: lorebook.metadata?.format ?? 'aventura',
          totalEntries: entries.length,
          entryBreakdown: breakdown,
        },
      })
      .then(() => {
        saving = false
        onClose() // Ideally close on save if it's the main save button, or just show success
      })
      .catch((e) => {
        error = e instanceof Error ? e.message : 'Failed to save lorebook'
        saving = false
      })
  }

  // Silent save function for auto-saving (doesn't close editor)
  async function handleSilentSave(): Promise<void> {
    if (!name.trim()) {
      throw new Error('Lorebook name is required')
    }

    // Update metadata entry breakdown
    const breakdown: Record<EntryType, number> = {
      character: 0,
      location: 0,
      item: 0,
      faction: 0,
      concept: 0,
      event: 0,
    }
    entries.forEach((e) => {
      if (breakdown[e.type] !== undefined) breakdown[e.type]++
    })

    await lorebookVault.update(lorebook.id, {
      name,
      description: description || null,
      entries,
      tags,
      metadata: {
        ...lorebook.metadata,
        format: lorebook.metadata?.format ?? 'aventura',
        totalEntries: entries.length,
        entryBreakdown: breakdown,
      },
    })
  }

  function handleAddEntry() {
    const newEntry: VaultLorebookEntry = {
      name: 'New Entry',
      type: 'character',
      description: '',
      keywords: [],
      aliases: [],
      injectionMode: 'keyword',
      priority: 10,
    }
    entries.push(newEntry)
    entries = entries // Trigger update
    selectedIndex = entries.length - 1
    activeTab = 'editor'
    // Ensure search doesn't hide the new entry
    searchQuery = ''
  }

  function handleDeleteEntry(index: number) {
    entries.splice(index, 1)
    entries = entries // Trigger update
    if (selectedIndex === index) {
      selectedIndex = null
    } else if (selectedIndex !== null && selectedIndex > index) {
      selectedIndex--
    }
  }

  function handleDuplicateEntry(index: number) {
    const entry = entries[index]
    const newEntry = JSON.parse(JSON.stringify(entry))
    newEntry.name = `${newEntry.name} (Copy)`
    entries.push(newEntry)
    entries = entries
    selectedIndex = entries.length - 1
  }
</script>

<ResponsiveModal.Root
  open={true}
  onOpenChange={(open) => {
    if (!open) onClose()
  }}
>
  <ResponsiveModal.Content
    class={cn(
      'flex h-[100dvh] w-full flex-col overflow-hidden rounded-none p-0 transition-all duration-200 sm:h-[90vh] sm:rounded-lg',
      isMaximized ? 'max-w-[90vw]' : 'sm:max-w-6xl',
    )}
  >
    <ResponsiveModal.Header
      class="relative flex flex-shrink-0 items-center justify-center border-b px-6 py-4"
    >
      <div class="absolute top-1/2 left-4 -translate-y-1/2">
        <Button
          variant="ghost"
          size="icon"
          class="text-muted-foreground hover:text-foreground h-8 w-8"
          onclick={() => (isMaximized = !isMaximized)}
        >
          {#if isMaximized}
            <Minimize2 class="h-4 w-4" />
          {:else}
            <Maximize2 class="h-4 w-4" />
          {/if}
          <span class="sr-only">{isMaximized ? 'Minimize' : 'Maximize'}</span>
        </Button>
      </div>
      <ResponsiveModal.Title class="text-center">Edit Lorebook</ResponsiveModal.Title>
      {#if error}
        <div
          class="text-destructive bg-background/95 absolute top-full left-0 w-full border-b py-1 text-center text-sm backdrop-blur"
        >
          {error}
        </div>
      {/if}
    </ResponsiveModal.Header>

    <Tabs.Root bind:value={activeTab} class="flex flex-1 flex-col overflow-hidden">
      <div class="bg-muted/20 flex shrink-0 items-center justify-between border-b">
        <Tabs.List class="h-12 justify-start bg-transparent p-0">
          <Tabs.Trigger
            value="editor"
            class="data-[state=active]:border-primary h-full rounded-none px-4 data-[state=active]:border-b-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <List class="mr-2 h-4 w-4" />
            Entries ({entries.length})
          </Tabs.Trigger>
          <Tabs.Trigger
            value="settings"
            class="data-[state=active]:border-primary h-full rounded-none px-4 data-[state=active]:border-b-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <Settings class="mr-2 h-4 w-4" />
            Settings
          </Tabs.Trigger>
        </Tabs.List>

        <div class="flex items-center gap-2 pr-2">
          {#if name.trim()}
            <Button
              variant={showInteractiveChat ? 'secondary' : 'ghost'}
              size="sm"
              class="gap-2"
              onclick={() => (showInteractiveChat = !showInteractiveChat)}
            >
              {#if showInteractiveChat}
                <X class="h-4 w-4" />
              {:else}
                <Bot class="h-4 w-4" />
              {/if}
              <span class="hidden sm:inline"
                >{showInteractiveChat ? 'Close Chat' : 'AI Assistant'}</span
              >
            </Button>
          {/if}
        </div>
      </div>

      <!-- Main Content Area -->
      <div class="bg-background relative flex flex-1 overflow-hidden">
        <!-- Tab Contents Wrapper -->
        <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Tabs.Content value="settings" class="touch-scroll m-0 flex-1 overflow-y-auto p-6">
            <div class="mx-auto max-w-2xl space-y-6">
              <div class="space-y-4">
                <div class="space-y-2">
                  <Label for="name">Lorebook Name</Label>
                  <Input id="name" bind:value={name} placeholder="Lorebook Name" />
                </div>

                <div class="space-y-2">
                  <Label for="description">Description</Label>
                  <Textarea
                    id="description"
                    bind:value={description}
                    rows={4}
                    placeholder="Describe what this lorebook contains..."
                    class="resize-none"
                  />
                </div>

                <div class="space-y-2">
                  <Label>Tags</Label>
                  <TagInput
                    value={tags}
                    type="lorebook"
                    onChange={(newTags) => (tags = newTags)}
                    placeholder="Add tags..."
                  />
                </div>

                <div class="bg-muted/30 rounded-lg border p-4">
                  <h4 class="mb-3 text-sm font-medium">Statistics</h4>
                  <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="bg-background flex justify-between rounded border p-2">
                      <span class="text-muted-foreground">Total Entries</span>
                      <span>{entries.length}</span>
                    </div>
                    <div class="bg-background flex justify-between rounded border p-2">
                      <span class="text-muted-foreground">Active Entries</span>
                      <span>{entries.filter((e) => e.injectionMode !== 'never').length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content
            value="editor"
            class="m-0 flex h-full flex-1 flex-col overflow-hidden sm:flex-row"
          >
            <!-- Sidebar (List) -->
            <div
              class={cn(
                'sm:bg-muted/10 flex min-h-0 w-full flex-col sm:w-80 sm:border-r',
                selectedIndex !== null && 'hidden sm:flex', // Hide on mobile if selected
              )}
            >
              <div class="space-y-3 border-b p-4">
                <div class="relative">
                  <Input
                    bind:value={searchQuery}
                    placeholder="Search entries..."
                    class="bg-background pl-9"
                    leftIcon={Search}
                  />
                </div>
                <Button class="w-full" onclick={handleAddEntry}>
                  <Plus class="h-4 w-4 " /> Add Entry
                </Button>
              </div>

              <div class="touch-scroll flex flex-1 flex-col space-y-1 overflow-y-auto p-2">
                {#if filteredEntries.length === 0}
                  <div
                    class="text-muted-foreground flex min-h-[200px] flex-1 flex-col items-center justify-center text-center text-sm"
                  >
                    {#if searchQuery}
                      No matches found
                    {:else}
                      No entries yet
                    {/if}
                  </div>
                {:else}
                  {#each filteredEntries as { entry, index } (index)}
                    {@const Icon = typeIcons[entry.type]}
                    <button
                      class={cn(
                        'hover:bg-muted/50 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors',
                        selectedIndex === index && 'bg-accent text-accent-foreground',
                      )}
                      onclick={() => (selectedIndex = index)}
                    >
                      <div
                        class={cn(
                          'bg-background/50 flex h-8 w-8 items-center justify-center rounded-md border',
                          selectedIndex === index && 'bg-background/20 border-transparent',
                        )}
                      >
                        <Icon class="h-4 w-4" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-medium">
                          {entry.name}
                        </div>
                        <div class="flex items-center gap-2 text-xs opacity-70">
                          <span class="capitalize">{entry.type}</span>
                          {#if entry.injectionMode === 'never'}
                            <span class="ml-auto flex items-center gap-0.5">
                              <EyeOff class="h-3 w-3" />
                            </span>
                          {/if}
                        </div>
                      </div>
                    </button>
                  {/each}
                {/if}
              </div>
            </div>

            <!-- Editor Area -->
            <div
              class={cn(
                'bg-background flex min-h-0 flex-1 flex-col overflow-hidden',
                selectedIndex === null && 'hidden sm:flex',
              )}
            >
              {#if selectedEntry !== null && selectedIndex !== null}
                <div class="flex flex-shrink-0 items-center justify-between border-b px-6 py-4">
                  <div class="flex min-w-0 flex-1 items-center gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      class="-ml-2 sm:hidden"
                      onclick={() => (selectedIndex = null)}
                    >
                      <ArrowLeft class="h-5 w-5" />
                    </Button>
                    <Input
                      bind:value={selectedEntry.name}
                      class="hover:border-input focus:border-input h-auto w-full min-w-[200px] border-transparent px-2 py-1 text-lg font-semibold transition-colors sm:w-auto"
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => handleDuplicateEntry(selectedIndex!)}
                    >
                      <span class="hidden sm:inline">Duplicate</span>
                      <Plus class="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onclick={() => handleDeleteEntry(selectedIndex!)}
                    >
                      <Trash2 class="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div class="touch-scroll flex-1 overflow-y-auto p-6">
                  <div class="mx-auto max-w-3xl space-y-6">
                    <div class="space-y-2">
                      <Label>Entry Type</Label>
                      <Select
                        type="single"
                        value={selectedEntry.type}
                        onValueChange={(v) => (selectedEntry.type = v as EntryType)}
                      >
                        <SelectTrigger id="entry-type">
                          {`${
                            selectedEntry.type.charAt(0).toUpperCase() + selectedEntry.type.slice(1)
                          }` || 'Select type'}
                        </SelectTrigger>
                        <SelectContent>
                          {#each entryTypes as option (option)}
                            <SelectItem value={option}
                              >{option.charAt(0).toUpperCase() + option.slice(1)}</SelectItem
                            >
                          {/each}
                        </SelectContent>
                      </Select>
                    </div>

                    <div class="space-y-2">
                      <Label>Keywords</Label>
                      <Input
                        value={selectedEntry.keywords.join(', ')}
                        oninput={(e) =>
                          (selectedEntry!.keywords = e.currentTarget.value
                            .split(',')
                            .map((k) => k.trim())
                            .filter(Boolean))}
                        placeholder="Comma-separated keywords..."
                      />
                      <p class="text-muted-foreground text-[0.8rem]">
                        Terms that trigger this entry when using 'Keyword' injection mode.
                      </p>
                    </div>

                    <div class="space-y-2">
                      <Label>Aliases</Label>
                      <Input
                        value={selectedEntry.aliases.join(', ')}
                        oninput={(e) =>
                          (selectedEntry!.aliases = e.currentTarget.value
                            .split(',')
                            .map((k) => k.trim())
                            .filter(Boolean))}
                        placeholder="Comma-separated alternative names..."
                      />
                      <p class="text-muted-foreground text-[0.8rem]">
                        Alternative names or spellings for this entry.
                      </p>
                    </div>

                    <div class="flex flex-1 flex-col space-y-2">
                      <Label>Description / Content</Label>
                      <Textarea
                        bind:value={selectedEntry.description}
                        class="min-h-[200px] font-mono text-sm leading-relaxed"
                        placeholder="Enter the lore content here..."
                      />
                    </div>

                    <div class="bg-muted/30 space-y-4 rounded-lg border p-4">
                      <h4 class="text-sm font-medium">Injection Settings</h4>

                      <div class="grid grid-cols-1 items-center gap-4 md:grid-cols-2">
                        <div class="space-y-2">
                          <Label class="text-xs">Injection Mode</Label>
                          <Select
                            type="single"
                            value={selectedEntry.injectionMode}
                            onValueChange={(v) =>
                              (selectedEntry.injectionMode = v as EntryInjectionMode)}
                          >
                            <SelectTrigger id="injection-mode">
                              {injectionModes.find((m) => m.value === selectedEntry.injectionMode)
                                ?.label || 'Select mode'}
                            </SelectTrigger>
                            <SelectContent>
                              {#each injectionModes as mode (mode.value)}
                                <SelectItem value={mode.value}>{mode.label}</SelectItem>
                              {/each}
                            </SelectContent>
                          </Select>
                          <p class="text-muted-foreground text-[0.8rem]">
                            {injectionModes.find((m) => m.value === selectedEntry.injectionMode)
                              ?.description || ''}
                          </p>
                        </div>

                        <div class="space-y-2">
                          <Label class="text-xs">Priority</Label>
                          <Input type="number" bind:value={selectedEntry.priority} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              {:else}
                <div class="text-muted-foreground flex flex-1 flex-col items-center justify-center">
                  <div class="bg-muted/30 mb-4 rounded-full p-6">
                    <Search class="h-8 w-8 opacity-50" />
                  </div>
                  <p class="text-lg font-medium">Select an entry to edit</p>
                  <p class="mt-2 text-sm">Or click "Add Entry" to create one</p>
                </div>
              {/if}
            </div>
          </Tabs.Content>
        </div>

        <!-- Interactive Chat Sidebar -->
        {#if showInteractiveChat && name.trim()}
          <div
            class={cn(
              'bg-background md:border-border absolute inset-0 z-50  flex flex-col transition-all duration-200 md:static md:border-l',
              isMaximized ? 'md:w-[50%]' : 'md:w-[400px]',
            )}
          >
            <InteractiveLorebookChat
              {entries}
              lorebookName={name}
              onEntriesChange={(newEntries) => {
                entries = newEntries
              }}
              onClose={() => (showInteractiveChat = false)}
              onSave={handleSilentSave}
            />
          </div>
        {/if}
      </div>
    </Tabs.Root>

    <ResponsiveModal.Footer class="bg-muted/40 flex-shrink-0 border-t px-6 py-4">
      <div class="flex w-full items-center gap-2 sm:justify-end">
        <Button
          variant="outline"
          class="w-10 p-0 sm:w-auto sm:px-4"
          onclick={onClose}
          disabled={saving}
        >
          <X class="h-4 w-4" />
          <span class="hidden sm:inline">Cancel</span>
        </Button>
        <Button class="flex-1 sm:flex-none" onclick={handleSave} disabled={saving || !name.trim()}>
          {#if saving}
            <div
              class=" h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            ></div>
          {:else}
            <Save class=" h-4 w-4" />
          {/if}
          Save Changes
        </Button>
      </div>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
