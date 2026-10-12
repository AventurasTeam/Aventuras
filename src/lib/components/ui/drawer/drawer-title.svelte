<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte'
  import { cn } from '#lib/utils/cn.ts'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: DrawerPrimitive.TitleProps = $props()
</script>

<DrawerPrimitive.Title
  bind:ref
  class={cn('text-lg leading-none font-semibold tracking-tight', className)}
  {...restProps}
/>
