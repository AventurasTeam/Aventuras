<!-- The modal frame's footer band, tinted like ModalHeader. -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'

  let { children }: { children: Snippet } = $props()
</script>

<ResponsiveModal.Footer class="bg-muted/40 gap-2 border-t px-6 py-4 sm:space-x-0">
  {@render children()}
</ResponsiveModal.Footer>
