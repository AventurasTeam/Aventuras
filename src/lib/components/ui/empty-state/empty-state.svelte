<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.ts'

  interface Props {
    icon?: any
    title: string
    description: string
    actionLabel?: string
    onAction?: () => void
    class?: string
    size?: 'default' | 'sm'
    children?: import('svelte').Snippet
  }

  let {
    icon: Icon,
    title,
    description,
    actionLabel,
    onAction,
    class: className = '',
    size = 'default',
    children,
  }: Props = $props()
</script>

<div class="flex flex-1 flex-col items-center justify-center text-center {className}">
  {#if Icon}
    <div class="bg-muted rounded-full {size === 'sm' ? 'mb-2 p-3' : 'mb-3 p-6'}">
      <Icon class="{size === 'sm' ? 'h-6 w-6' : 'h-12 w-12'} text-muted-foreground" />
    </div>
  {/if}
  <h2 class="{size === 'sm' ? 'text-sm' : 'text-xl'} text-foreground font-semibold">{title}</h2>
  <p
    class="text-muted-foreground max-w-sm {size === 'sm'
      ? 'mb-2 text-xs'
      : 'mb-4 text-sm'} leading-snug"
  >
    {description}
  </p>
  {#if children}
    {@render children()}
  {:else if actionLabel && onAction}
    <Button variant="default" onclick={onAction}>
      {actionLabel}
    </Button>
  {/if}
</div>
