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
  <Drawer.Title class={cn('', className)} {...props}>
    {@render children?.()}
  </Drawer.Title>
{:else}
  <Dialog.Title class={className} {...props}>
    {@render children?.()}
  </Dialog.Title>
{/if}
