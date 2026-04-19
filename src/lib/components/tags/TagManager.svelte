<script lang="ts">
  import { tagStore } from '$lib/stores/tags.svelte'
  import type { VaultTag, VaultType } from '$lib/types'
  import { Trash2, Edit2, Check, Plus } from 'lucide-svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs'
  import { Input } from '$lib/components/ui/input'
  import { Button } from '$lib/components/ui/button'
  import { cn } from '$lib/utils/cn'
  import { fade } from 'svelte/transition'

  interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
  }

  let { open, onOpenChange }: Props = $props()

  let activeTab = $state<VaultType>('character')
  let searchQuery = $state('')
  let editingId = $state<string | null>(null)
  let editName = $state('')
  let editColor = $state('')

  const colors = [
    'red-500',
    'orange-500',
    'amber-500',
    'yellow-500',
    'lime-500',
    'green-500',
    'emerald-500',
    'teal-500',
    'cyan-500',
    'sky-500',
    'blue-500',
    'indigo-500',
    'violet-500',
    'purple-500',
    'fuchsia-500',
    'pink-500',
    'rose-500',
  ]

  const filteredTags = $derived.by(() => {
    let tags = tagStore.getTagsForType(activeTab)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      tags = tags.filter((t) => t.name.toLowerCase().includes(q))
    }
    return tags
  })

  const canCreate = $derived(
    searchQuery.trim() &&
      !filteredTags.some((t) => t.name.toLowerCase() === searchQuery.toLowerCase()),
  )

  function startEdit(tag: VaultTag) {
    editingId = tag.id
    editName = tag.name
    editColor = tag.color
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return
    await tagStore.update(editingId, {
      name: editName.trim(),
      color: editColor,
    })
    editingId = null
  }

  async function handleDelete(id: string) {
    if (
      confirm('Are you sure you want to delete this tag? It will be removed from all vault items.')
    ) {
      await tagStore.delete(id)
    }
  }

  async function handleCreate() {
    if (!searchQuery.trim()) return
    await tagStore.add(searchQuery.trim(), activeTab)
    searchQuery = ''
  }
</script>

<ResponsiveModal.Root bind:open {onOpenChange}>
  <ResponsiveModal.Content
    class="flex w-full max-w-none flex-col lg:w-[calc(100%-2rem)] lg:max-w-2xl"
    style="height: 500px;"
  >
    <ResponsiveModal.Header title="Manage Tags" />

    <div class="flex flex-1 flex-col gap-4 overflow-hidden p-4">
      <!-- Tabs -->
      <Tabs value={activeTab} onValueChange={(v) => (activeTab = v as VaultType)}>
        <TabsList class="grid w-full grid-cols-3">
          <TabsTrigger value="character">Characters</TabsTrigger>
          <TabsTrigger value="lorebook">Lorebooks</TabsTrigger>
          <TabsTrigger value="scenario">Scenarios</TabsTrigger>
        </TabsList>
      </Tabs>

      <!-- Search/Add Bar -->
      <div class="flex flex-shrink-0 gap-2">
        <div class="relative flex-1">
          <Input
            bind:value={searchQuery}
            placeholder={`Search or add ${activeTab} tags...`}
            onkeydown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
        <Button icon={Plus} label="Add" disabled={!canCreate} onclick={handleCreate} />
      </div>

      <!-- Tag List -->
      <div class="flex-1 overflow-y-auto pr-2">
        {#if filteredTags.length > 0}
          <div class="space-y-2 pb-4">
            {#each filteredTags as tag (tag.id)}
              <div
                class={cn(
                  'group bg-muted/40 hover:bg-muted/60 flex items-center justify-between rounded-lg border p-2 transition-colors',
                  editingId === tag.id && 'border-primary',
                )}
                in:fade={{ duration: 150 }}
              >
                {#if editingId === tag.id}
                  <!-- Edit Mode -->
                  <div class="flex flex-1 items-center gap-3">
                    <!-- Color Picker -->
                    <div class="relative">
                      <div
                        class={`h-6 w-6 rounded-full bg-${editColor} ring-muted cursor-pointer ring-2`}
                      ></div>
                      <div
                        class="bg-background absolute top-full left-0 z-10 mt-2 hidden w-48 flex-wrap gap-1 rounded-lg border p-2 shadow-xl group-hover:flex"
                      >
                        {#each colors as color, i (color + i)}
                          <button
                            class={`h-5 w-5 rounded-full bg-${color} ring-white hover:ring-2`}
                            onclick={() => (editColor = color)}
                            title={color}
                          ></button>
                        {/each}
                      </div>
                    </div>

                    <Input
                      bind:value={editName}
                      class="h-8 flex-1"
                      onkeydown={(e) => e.key === 'Enter' && saveEdit()}
                    />

                    <div class="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8 text-green-500 hover:bg-green-500/10 hover:text-green-600"
                        onclick={saveEdit}
                      >
                        <Check class="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8"
                        onclick={() => (editingId = null)}
                      >
                        <Trash2 class="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                {:else}
                  <!-- View Mode -->
                  <div class="flex items-center gap-3">
                    <div class={`h-3 w-3 rounded-full bg-${tag.color}`}></div>
                    <span class="font-medium">{tag.name}</span>
                  </div>

                  <div
                    class="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-8 w-8"
                      onclick={() => startEdit(tag)}
                    >
                      <Edit2 class="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                      onclick={() => handleDelete(tag.id)}
                    >
                      <Trash2 class="h-4 w-4" />
                    </Button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <div class="text-muted-foreground -mt-2 flex h-full flex-col items-center justify-center">
            <p>No tags found.</p>
            <p class="text-sm">Create one above to get started.</p>
          </div>
        {/if}
      </div>
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
