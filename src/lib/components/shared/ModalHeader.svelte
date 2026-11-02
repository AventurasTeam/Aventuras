<!--
  The modal frame's header: the title alone, centred, on a tinted band that matches ModalFooter's,
  so the two read as a frame around the body. See docs/development/ui-components.md.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { cn } from '#lib/utils/cn.ts'

  interface Props {
    title: string
    /** Only for a confirmation that warns, drawn before the title. */
    titleIcon?: Snippet
    /** Desktop only, for a modal with no Cancel to leave by. */
    closeButton?: boolean
  }

  let { title, titleIcon, closeButton = false }: Props = $props()
</script>

<ResponsiveModal.Header
  class="bg-muted/40 border-b px-6 py-4 text-center sm:text-center"
  {closeButton}
>
  <ResponsiveModal.Title
    class={cn('text-center break-words', titleIcon && 'flex items-center justify-center gap-2')}
  >
    {@render titleIcon?.()}
    {title}
  </ResponsiveModal.Title>
</ResponsiveModal.Header>
