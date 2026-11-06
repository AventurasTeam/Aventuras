<!-- The modal frame's footer band, tinted like ModalHeader. -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { cn } from '#lib/utils/cn.ts'

  let { children, class: className }: { children: Snippet; class?: string } = $props()
</script>

<ResponsiveModal.Footer class={cn('bg-muted/40 gap-2 border-t px-6 py-4 sm:space-x-0', className)}>
  {@render children()}
</ResponsiveModal.Footer>
