<!--
  A tool opened from the sync sheet, in the modal frame. A sheet on a phone like the
  sync sheet itself: see docs/development/ui-components.md.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import ModalFooter from '#lib/components/shared/ModalFooter.svelte'
  import ModalHeader from '#lib/components/shared/ModalHeader.svelte'

  interface Props {
    open: boolean
    onClose: () => void
    title: string
    children: Snippet
    footer: Snippet
  }

  let { open, onClose, title, children, footer }: Props = $props()
</script>

<ResponsiveModal.Root bind:open={() => open, (next) => !next && onClose()}>
  <ResponsiveModal.Content handle={false} class="flex max-h-[85dvh] max-w-md flex-col gap-0 p-0">
    <ModalHeader {title} />
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
      {@render children()}
    </div>
    <ModalFooter>
      {@render footer()}
    </ModalFooter>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
