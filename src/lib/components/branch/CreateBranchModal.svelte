<script lang="ts">
  import { story } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import type { Checkpoint } from '#lib/types/index.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'
  import { Input } from '#lib/components/ui/input/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { GitBranch } from '@lucide/svelte'
  import ModalActions from '#lib/components/shared/ModalActions.svelte'

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
    <ModalActions
      label="Create Branch"
      icon={GitBranch}
      tone="branch"
      onCancel={cancel}
      onConfirm={() => void create()}
      busy={saving}
      disabled={!name.trim() || !checkpoint}
    />
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
