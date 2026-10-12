<script lang="ts">
  import * as Dialog from '#lib/components/ui/dialog/index.ts'
  import * as Drawer from '#lib/components/ui/drawer/index.ts'
  import { getResponsiveModalContext } from './context'
  import { cn } from '#lib/utils/cn.ts'
  import type { Snippet } from 'svelte'

  type Props = {
    children?: Snippet
    class?: string
  } & any

  let { children, class: className, ...props }: Props = $props()
  const { isMobile } = getResponsiveModalContext()
</script>

{#if isMobile.current}
  <Drawer.Description class={cn('text-left', className)} {...props}>
    {@render children?.()}
  </Drawer.Description>
{:else}
  <Dialog.Description class={className} {...props}>
    {@render children?.()}
  </Dialog.Description>
{/if}
