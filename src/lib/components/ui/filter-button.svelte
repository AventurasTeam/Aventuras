<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Filter } from '@lucide/svelte'
  import { cn } from '#lib/utils/cn.ts'
  import type { Component, ComponentProps } from 'svelte'

  type Props = ComponentProps<typeof Button> & {
    active?: boolean
    label: string
    icon?: Component<{ class?: string }>
  }

  let { active = false, label, icon: Icon = Filter, class: className, ...rest }: Props = $props()
</script>

<!-- Amber while the list differs from its default. It keeps the mark on hover, which the
     outline button's own hover would otherwise replace. -->
<Button
  variant="outline"
  size="icon"
  class={cn('h-7 w-7', active && 'text-amber-500 hover:text-amber-500', className)}
  aria-label={label}
  title={label}
  {...rest}
>
  <Icon class="h-3.5 w-3.5" />
</Button>
