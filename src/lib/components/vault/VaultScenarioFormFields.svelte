<script lang="ts">
  import type { VaultScenarioInput } from '$lib/services/ai/sdk/schemas/vault'
  import type { VaultCharacter } from '$lib/types'
  import { characterVault } from '$lib/stores/characterVault.svelte'
  import {
    Plus,
    Trash2,
    Users,
    MessageSquare,
    FileText,
    ChevronRight,
    Search,
    User,
  } from 'lucide-svelte'
  import TagInput from '$lib/components/tags/TagInput.svelte'
  import { normalizeImageDataUrl } from '$lib/utils/image'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Label } from '$lib/components/ui/label'
  import * as Tabs from '$lib/components/ui/tabs'
  import * as Avatar from '$lib/components/ui/avatar'
  import * as Collapsible from '$lib/components/ui/collapsible'

  interface Props {
    data: VaultScenarioInput
    onUpdate: (data: VaultScenarioInput) => void
    changedFields?: Set<string>
  }

  let { data, onUpdate, changedFields }: Props = $props()

  const changed = (field: string) =>
    changedFields?.has(field)
      ? 'border-l-2 border-l-blue-400/50 bg-blue-500/5 pl-3 -ml-3 rounded-lg'
      : ''

  let showCharacterSelector = $state(false)
  let charSearchQuery = $state('')
  let activeTab = $state('general')

  const filteredCharacters = $derived.by(() => {
    if (!showCharacterSelector) return []
    let chars = characterVault.characters
    if (charSearchQuery.trim()) {
      const q = charSearchQuery.toLowerCase()
      chars = chars.filter((c) => c.name.toLowerCase().includes(q))
    }
    return chars
  })

  function handleInput() {
    onUpdate({ ...data })
  }

  function addNpc() {
    data.npcs.push({
      name: 'New NPC',
      role: 'Supporting Character',
      description: '',
      relationship: 'Neutral',
      traits: [],
    })
    handleInput()
  }

  function removeNpc(index: number) {
    data.npcs = data.npcs.filter((_, i) => i !== index)
    handleInput()
  }

  function addNpcFromCharacter(char: VaultCharacter) {
    data.npcs.push({
      name: char.name,
      role: 'Supporting Character',
      description: char.description || '',
      relationship: 'Neutral',
      traits: [...char.traits],
    })
    showCharacterSelector = false
    handleInput()
  }

  function addGreeting() {
    data.alternateGreetings = [...(data.alternateGreetings ?? []), '']
    handleInput()
  }

  function removeGreeting(index: number) {
    data.alternateGreetings = (data.alternateGreetings ?? []).filter((_, i) => i !== index)
    handleInput()
  }
</script>

<Tabs.Root
  value={activeTab}
  onValueChange={(v) => (activeTab = v)}
  class="flex flex-1 flex-col overflow-hidden"
>
  <div class="bg-muted/20 border-b">
    <Tabs.List class="h-12 w-full justify-start bg-transparent p-0">
      <Tabs.Trigger
        value="general"
        class="data-[state=active]:border-primary h-full rounded-none px-4 data-[state=active]:border-b-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
      >
        <FileText class="mr-2 h-4 w-4" />
        General
      </Tabs.Trigger>
      <Tabs.Trigger
        value="npcs"
        class="data-[state=active]:border-primary h-full rounded-none px-4 data-[state=active]:border-b-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
      >
        <Users class="mr-2 h-4 w-4" />
        NPCs ({data.npcs.length})
      </Tabs.Trigger>
      <Tabs.Trigger
        value="opening"
        class="data-[state=active]:border-primary h-full rounded-none px-4 data-[state=active]:border-b-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
      >
        <MessageSquare class="mr-2 h-4 w-4" />
        Opening
      </Tabs.Trigger>
    </Tabs.List>
  </div>

  <div class="bg-background flex-1 overflow-y-auto">
    <div class="mx-auto max-w-3xl space-y-6 px-4 py-4 md:px-6">
      <Tabs.Content value="general" class="mt-0 space-y-6">
        <div class="space-y-4">
          <div class="space-y-2 {changed('name')}">
            <Label for="name">Scenario Name</Label>
            <Input
              id="name"
              bind:value={data.name}
              oninput={handleInput}
              placeholder="e.g. The Cyberpunk City"
            />
          </div>

          <div class="space-y-2 {changed('description')}">
            <Label for="description">Description</Label>
            <Textarea
              id="description"
              value={data.description ?? ''}
              oninput={(e) => {
                data.description = e.currentTarget.value || null
                handleInput()
              }}
              rows={2}
              placeholder="Brief overview shown on the card..."
              class="resize-none"
            />
          </div>

          <div class="space-y-2 {changed('primaryCharacterName')}">
            <Label for="protagonist">Protagonist Name</Label>
            <Input
              id="protagonist"
              bind:value={data.primaryCharacterName}
              oninput={handleInput}
              placeholder="Protagonist name"
            />
          </div>

          <div class="space-y-2 {changed('settingSeed')}">
            <Label for="seed">Setting Seed</Label>
            <div class="relative">
              <Textarea
                id="seed"
                bind:value={data.settingSeed}
                oninput={handleInput}
                rows={10}
                class="min-h-[200px] resize-y font-mono text-sm leading-relaxed"
                placeholder="Detailed world setting..."
              />
              <div
                class="text-muted-foreground bg-background/80 absolute right-2 bottom-2 rounded px-2 py-0.5 text-xs"
              >
                Markdown supported
              </div>
            </div>
          </div>

          <div class="space-y-2 {changed('tags')}">
            <Label>Tags</Label>
            <TagInput
              value={data.tags}
              type="scenario"
              onChange={(t) => {
                data.tags = t
                handleInput()
              }}
              placeholder="Add tags..."
            />
          </div>
        </div>
      </Tabs.Content>

      <Tabs.Content value="npcs" class="mt-0 space-y-6 {changed('npcs')}">
        <div
          class="bg-background sticky top-0 z-10 mb-4 flex items-center justify-between border-b pt-2 pb-4"
        >
          <h3 class="text-muted-foreground text-sm font-medium">Supporting Characters</h3>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onclick={() => {
                charSearchQuery = ''
                showCharacterSelector = true
              }}
            >
              <Users class="h-3.5 w-3.5 " />
              Import
            </Button>
            <Button size="sm" onclick={addNpc}>
              <Plus class="h-3.5 w-3.5 " />
              New NPC
            </Button>
          </div>
        </div>

        <div class="space-y-3">
          {#if data.npcs.length === 0}
            <div
              class="text-muted-foreground bg-muted/30 flex flex-col items-center justify-center rounded-lg border border-dashed p-8"
            >
              <Users class="mb-2 h-10 w-10 opacity-20" />
              <p>No NPCs defined yet.</p>
              <Button variant="link" onclick={addNpc}>Create your first NPC</Button>
            </div>
          {:else}
            {#each data.npcs as npc, i (i)}
              <div class="bg-card text-card-foreground group rounded-lg border shadow-sm">
                <Collapsible.Root>
                  <div class="flex items-center gap-3 p-3 pl-4">
                    <Collapsible.Trigger
                      class="group/trigger flex flex-1 items-center gap-2 text-left"
                    >
                      <div
                        class="bg-muted/50 group-hover/trigger:bg-muted flex h-8 w-8 items-center justify-center rounded-md transition-colors"
                      >
                        <ChevronRight
                          class="h-4 w-4 transition-transform duration-200 group-data-[state=open]/trigger:rotate-90"
                        />
                      </div>
                      <div class="flex-1">
                        <div class="text-sm font-medium">
                          {npc.name || 'Unnamed NPC'}
                        </div>
                        <div class="text-muted-foreground text-xs">
                          {npc.role || 'No role'}
                        </div>
                      </div>
                    </Collapsible.Trigger>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-muted-foreground hover:text-destructive h-8 w-8"
                      onclick={() => removeNpc(i)}
                    >
                      <Trash2 class="h-4 w-4" />
                    </Button>
                  </div>

                  <Collapsible.Content>
                    <div class="bg-muted/10 mt-2 space-y-4 border-t p-4 px-4 pt-0 pb-4">
                      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div class="space-y-2">
                          <Label class="text-xs">Name</Label>
                          <Input bind:value={npc.name} oninput={handleInput} class="h-8" />
                        </div>
                        <div class="space-y-2">
                          <Label class="text-xs">Role</Label>
                          <Input bind:value={npc.role} oninput={handleInput} class="h-8" />
                        </div>
                      </div>

                      <div class="space-y-2">
                        <Label class="text-xs">Description</Label>
                        <Textarea
                          bind:value={npc.description}
                          oninput={handleInput}
                          rows={2}
                          class="min-h-[60px] resize-none"
                        />
                      </div>

                      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div class="space-y-2">
                          <Label class="text-xs">Relationship</Label>
                          <Input bind:value={npc.relationship} oninput={handleInput} class="h-8" />
                        </div>
                        <div class="space-y-2">
                          <Label class="text-xs">Traits</Label>
                          <Input
                            value={npc.traits.join(', ')}
                            oninput={(e) => {
                              npc.traits = e.currentTarget.value
                                .split(',')
                                .map((t) => t.trim())
                                .filter(Boolean)
                              handleInput()
                            }}
                            class="h-8"
                            placeholder="Comma separated..."
                          />
                        </div>
                      </div>
                    </div>
                  </Collapsible.Content>
                </Collapsible.Root>
              </div>
            {/each}
          {/if}
        </div>
      </Tabs.Content>

      <Tabs.Content value="opening" class="mt-0 space-y-6">
        <div class="space-y-2 {changed('firstMessage')}">
          <Label>First Message</Label>
          <Textarea
            value={data.firstMessage ?? ''}
            oninput={(e) => {
              data.firstMessage = e.currentTarget.value || null
              handleInput()
            }}
            rows={6}
            class="font-mono text-sm leading-relaxed"
            placeholder="The opening scene..."
          />
          <p class="text-muted-foreground text-[0.8rem]">Shown when the story begins.</p>
        </div>

        <div class="space-y-4 {changed('alternateGreetings')}">
          <div class="flex items-center justify-between">
            <Label>Alternate Greetings</Label>
            <Button variant="outline" size="sm" onclick={addGreeting}>
              <Plus class="h-3.5 w-3.5 " /> Add
            </Button>
          </div>

          {#each data.alternateGreetings ?? [] as _greeting, i (i)}
            <div class="relative">
              <Textarea
                value={data.alternateGreetings?.[i] ?? ''}
                oninput={(e) => {
                  if (data.alternateGreetings) {
                    data.alternateGreetings[i] = e.currentTarget.value
                  }
                  handleInput()
                }}
                rows={3}
                class="pr-10 font-mono text-sm"
                placeholder={`Variation ${i + 1}...`}
              />
              <Button
                variant="ghost"
                size="icon"
                class="text-muted-foreground hover:text-destructive absolute top-2 right-2 h-6 w-6"
                onclick={() => removeGreeting(i)}
              >
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          {/each}

          {#if (data.alternateGreetings ?? []).length === 0}
            <p class="text-muted-foreground py-4 text-center text-sm italic">
              No variations added.
            </p>
          {/if}
        </div>
      </Tabs.Content>
    </div>
  </div>
</Tabs.Root>

<!-- Character Import Modal -->
{#if showCharacterSelector}
  <ResponsiveModal.Root
    open={showCharacterSelector}
    onOpenChange={(open) => (showCharacterSelector = open)}
  >
    <ResponsiveModal.Content class="flex h-[500px] flex-col p-0 sm:max-w-md">
      <ResponsiveModal.Header class="border-b px-4 py-3">
        <h3 class="font-semibold">Import Character</h3>
      </ResponsiveModal.Header>

      <div class="border-b p-4">
        <div class="relative">
          <Search class="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input bind:value={charSearchQuery} placeholder="Search characters..." class="pl-9" />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        {#if filteredCharacters.length === 0}
          <div class="text-muted-foreground flex h-full flex-col items-center justify-center">
            <Users class="mb-2 h-8 w-8 opacity-50" />
            <p>No characters found</p>
          </div>
        {:else}
          {#each filteredCharacters as char (char.id)}
            <button
              class="hover:bg-muted flex w-full items-center gap-3 rounded-md p-3 text-left transition-colors"
              onclick={() => addNpcFromCharacter(char)}
            >
              <Avatar.Root class="h-10 w-10 border">
                <Avatar.Image
                  src={normalizeImageDataUrl(char.portrait) ?? ''}
                  class="object-cover"
                />
                <Avatar.Fallback><User class="h-5 w-5" /></Avatar.Fallback>
              </Avatar.Root>
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium">{char.name}</div>
                <div class="text-muted-foreground truncate text-xs">
                  {char.traits.slice(0, 3).join(', ')}
                </div>
              </div>
              <Plus class="text-muted-foreground h-4 w-4" />
            </button>
          {/each}
        {/if}
      </div>
    </ResponsiveModal.Content>
  </ResponsiveModal.Root>
{/if}
