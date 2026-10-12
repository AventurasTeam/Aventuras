<script lang="ts">
  import type { Separator as SeparatorPrimitive } from 'bits-ui'
  import { Separator } from '#lib/components/ui/separator/index.ts'
  import { cn } from '#lib/utils/cn.ts'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: SeparatorPrimitive.RootProps = $props()
</script>

<Separator bind:ref class={cn('bg-muted -mx-1 my-1 h-px', className)} {...restProps} />
