<script lang="ts">
  import type { VaultLorebook } from '$lib/types'
  import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { cn } from '$lib/utils/cn'
  import VaultLorebookEditorContent from './VaultLorebookEditorContent.svelte'
  import type { FocusedEntity } from '$lib/services/ai/vault/InteractiveVaultService'

  interface Props {
    lorebook: VaultLorebook
    onClose: () => void
    onOpenAssistant?: (entity: FocusedEntity) => void
  }

  let { lorebook, onClose, onOpenAssistant }: Props = $props()

  async function handleSave(updated: VaultLorebook) {
    await lorebookVault.update(updated.id, updated)
  }

  async function handleSaveAndClose(updated: VaultLorebook) {
    await lorebookVault.update(updated.id, updated)
    onClose()
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
      'flex h-[100dvh] w-full flex-col overflow-hidden rounded-none p-0 transition-all duration-200 sm:h-[90vh] sm:max-w-6xl sm:rounded-lg',
    )}
  >
    <VaultLorebookEditorContent
      {lorebook}
      onSave={handleSave}
      onSaveAndClose={handleSaveAndClose}
      {onClose}
      {onOpenAssistant}
      initialEntryIndex={null}
    />
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
