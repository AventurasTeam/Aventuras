<script lang="ts">
  import * as Dialog from '#lib/components/ui/dialog/index.ts'
  import * as Drawer from '#lib/components/ui/drawer/index.ts'
  import { getResponsiveModalContext } from './context'
  import { cn } from '#lib/utils/cn.ts'
  import type { Snippet } from 'svelte'

  type Props = {
    children: Snippet
    class?: string
    [key: string]: unknown
  }

  let { children, class: className, ...props }: Props = $props()
  const { isMobile } = getResponsiveModalContext()
</script>

{#if isMobile.current}
  <Drawer.Footer class={cn('border-t pt-2', className)} {...props}>
    {@render children?.()}
  </Drawer.Footer>
{:else}
  <Dialog.Footer
    class={cn(
      // Rounded at every width, like the header, so it never covers the dialog's border corners.
      'border-border bg-background relative z-10 rounded-b-lg border-t py-4 shadow-[0_-1px_3px_rgba(0,0,0,0.05)]',
      className,
    )}
    {...props}
  >
    {@render children?.()}
  </Dialog.Footer>
{/if}
