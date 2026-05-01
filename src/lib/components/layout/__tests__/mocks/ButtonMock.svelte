<script lang="ts">
  let {
    onclick,
    title,
    href,
    target,
    rel,
    children,
    ...rest
  }: {
    onclick?: (e: MouseEvent) => void
    title?: string
    href?: string
    target?: string
    rel?: string
    children?: import('svelte').Snippet
    [key: string]: unknown
  } = $props()
</script>

{#if href}
  <a {href} {target} {rel} {title} class={rest.class as string}>{@render children?.()}</a>
{:else}
  <button {onclick} {title} class={rest.class as string}>{@render children?.()}</button>
{/if}