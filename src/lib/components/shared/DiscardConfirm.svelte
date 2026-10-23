<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.ts'
  import { TriangleAlert } from '@lucide/svelte'
  import { cn } from '#lib/utils/cn.ts'
  import { FEATURE_COLORS } from './featureColors'

  interface Props {
    open: boolean
    title?: string
    description?: string
    keepLabel?: string
    discardLabel?: string
    onCancel: () => void
    onDiscard: () => void
  }

  let {
    open,
    title = 'Discard this story?',
    description = 'Everything you have filled in so far will be lost.',
    keepLabel = 'Keep editing',
    discardLabel = 'Discard',
    onCancel,
    onDiscard,
  }: Props = $props()

  const uid = $props.id()

  let cancelButton = $state<HTMLElement | null>(null)

  $effect(() => {
    if (open) cancelButton?.focus()
  })
</script>

<!--
  Belongs inside its modal's own content, not in a nested modal: a second modal layer would
  take over the dismissible and escape layers this prompt exists to intercept.
-->
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bg-background/80 absolute inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
    onclick={(e) => e.target === e.currentTarget && onCancel()}
  >
    <div
      class="bg-card w-full max-w-sm rounded-lg border p-5 shadow-lg"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="{uid}-title"
      aria-describedby="{uid}-description"
    >
      <div class="flex items-start gap-3">
        <TriangleAlert class="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div class="min-w-0">
          <h2 id="{uid}-title" class="font-semibold">{title}</h2>
          <p id="{uid}-description" class="text-muted-foreground mt-1 text-sm">
            {description}
          </p>
        </div>
      </div>

      <!-- The same pair as an action modal's footer: neutral to stay, the delete tone to go. -->
      <div class="mt-5 flex gap-2 sm:justify-end">
        <Button
          bind:ref={cancelButton}
          variant="outline"
          class="flex-1 sm:flex-none"
          onclick={onCancel}
        >
          {keepLabel}
        </Button>
        <Button
          variant="feature"
          class={cn('flex-1 sm:flex-none', FEATURE_COLORS.delete.vars)}
          onclick={onDiscard}
        >
          {discardLabel}
        </Button>
      </div>
    </div>
  </div>
{/if}
