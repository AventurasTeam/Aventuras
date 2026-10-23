<script lang="ts">
  import { story } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import type { Checkpoint } from '#lib/types/index.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'
  import { Input } from '#lib/components/ui/input/index.ts'
  import { GitBranch } from '@lucide/svelte'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'

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
<ActionModal
  presentation="sheet"
  bind:open
  onCancel={cancel}
  title="Create a branch"
  action={{
    label: 'Create branch',
    icon: GitBranch,
    tone: 'branch',
    disabled: !name.trim() || !checkpoint,
    onConfirm: () => void create(),
  }}
  busy={saving}
>
  {#snippet description()}
    From the checkpoint “{checkpoint?.name}”{#if forkEntry}
      at entry {entryNumber(forkEntry)}{/if}.
  {/snippet}
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
</ActionModal>
