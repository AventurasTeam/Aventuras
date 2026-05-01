<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    child,
    children,
  }: {
    child?: Snippet<[{ props: Record<string, unknown> }]>
    children?: Snippet
  } = $props()
</script>

{#if child}
  {@render child({ props: {} })}
{:else}
  {@render children?.()}
{/if}