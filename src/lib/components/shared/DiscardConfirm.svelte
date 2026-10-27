<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.ts'
  import { cn } from '#lib/utils/cn.ts'
  import { FEATURE_COLORS } from './featureColors'
  import type { PendingQuestion } from './pendingQuestion.svelte'

  let { question }: { question: PendingQuestion } = $props()

  const shown = $derived(question.current)
  const open = $derived(shown !== null)

  const uid = $props.id()

  let box = $state<HTMLElement | null>(null)

  // The question takes the focus off the inert modal behind it, but no answer is preselected.
  $effect(() => {
    if (open) box?.focus()
  })
</script>

<!--
  Belongs inside its modal's own content, not in a nested modal: a second modal layer would
  take over the dismissible and escape layers this prompt exists to intercept.
-->
<!-- Past the modal's border by a few pixels, with a wider radius, so its edge is covered too. -->
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bg-background/80 absolute -inset-1 z-50 flex items-center justify-center rounded-xl p-5 backdrop-blur-sm"
    onclick={(e) => e.target === e.currentTarget && question.answer(false)}
  >
    <div
      bind:this={box}
      tabindex="-1"
      class="bg-card w-full max-w-sm rounded-lg border p-5 shadow-lg outline-none"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="{uid}-title"
      aria-describedby="{uid}-description"
    >
      <h2 id="{uid}-title" class="font-semibold">{shown?.title}</h2>
      <p id="{uid}-description" class="text-muted-foreground mt-1 text-sm">
        {shown?.description}
      </p>

      <!-- The same pair as an action modal's footer: neutral to stay, the delete tone to go. -->
      <div class="mt-5 flex flex-wrap gap-2 sm:flex-nowrap sm:justify-end">
        <Button
          variant="outline"
          class="basis-pair grow sm:grow-0 sm:basis-auto"
          onclick={() => question.answer(false)}
        >
          {shown?.keepLabel ?? 'Keep editing'}
        </Button>
        <Button
          variant="feature"
          class={cn('basis-pair grow sm:grow-0 sm:basis-auto', FEATURE_COLORS.delete.vars)}
          onclick={() => question.answer(true)}
        >
          {shown?.confirmLabel ?? 'Discard'}
        </Button>
      </div>
    </div>
  </div>
{/if}
