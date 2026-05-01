<script lang="ts">
  let {
    class: className,
    'data-icon': dataIcon,
    ...rest
  }: {
    class?: string
    'data-icon'?: string
    [key: string]: unknown
  } = $props()
</script>

<svg class={className} data-icon={dataIcon ?? 'icon'} aria-hidden="true"></svg>