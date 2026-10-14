<script lang="ts">
  import { story } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import type { Checkpoint } from '#lib/types/index.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Input } from '#lib/components/ui/input/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { GitBranch, Loader2, X } from '@lucide/svelte'

  let {
    open = $bindable(false),
    checkpoint,
  }: {
    open?: boolean
    /** The checkpoint the branch forks from. */
    checkpoint: Checkpoint | null
  } = $props()

  let name = $state('')
  let saving = $state(false)

  const forkEntry = $derived(
    checkpoint ? story.entries.find((e) => e.id === checkpoint.lastEntryId) : undefined,
  )

  function cancel() {
    if (saving) return
    open = false
    name = ''
  }

  async function create() {
    if (!name.trim() || saving || !checkpoint) return
    saving = true
    try {
      await story.createBranchFromCheckpoint(name.trim(), checkpoint.lastEntryId, checkpoint.id)
      open = false
      name = ''
    } catch (error) {
      console.error('[CreateBranchModal] Failed to create branch:', error)
      ui.showToast(errMessage(error), 'error')
    } finally {
      saving = false
    }
  }
</script>

<!-- Modal for the same reason as the checkpoint form: nothing may change while the branch is cut. -->
<ResponsiveModal.Root
  bind:open={
    () => open,
    (next) => {
      if (!next) cancel()
    }
  }
  dismissible={!saving}
>
  <ResponsiveModal.Content
    class="max-w-md gap-0 p-0"
    interactOutsideBehavior="ignore"
    escapeKeydownBehavior={saving ? 'ignore' : 'close'}
  >
    <ResponsiveModal.Header class="border-b px-6 py-4" closeButton={false}>
      <ResponsiveModal.Title>Create branch</ResponsiveModal.Title>
      <ResponsiveModal.Description>
        Create a new branch from the Checkpoint “{checkpoint?.name}”{#if forkEntry}
          at Entry {entryNumber(forkEntry)}{/if}
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>
    <div class="space-y-3 px-6 py-4">
      <Input
        type="text"
        class="h-9 text-sm"
        placeholder="Branch name..."
        bind:value={name}
        disabled={saving}
        onkeydown={(e) => {
          if (e.key === 'Enter') void create()
        }}
      />
    </div>
    <ResponsiveModal.Footer class="border-t px-6 py-4">
      <Button variant="secondary" size="sm" onclick={cancel} disabled={saving} class="h-9 px-3">
        <X class="mr-1.5 h-4 w-4" />
        Cancel
      </Button>
      <Button
        size="sm"
        onclick={() => void create()}
        disabled={!name.trim() || saving || !checkpoint}
        class="h-9 bg-amber-500 px-3 text-white hover:bg-amber-600"
      >
        {#if saving}
          <Loader2 class="mr-1.5 h-4 w-4 animate-spin" />
        {:else}
          <GitBranch class="mr-1.5 h-4 w-4" />
        {/if}
        Create Branch
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
