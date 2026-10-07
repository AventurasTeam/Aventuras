<script lang="ts">
  import { untrack } from 'svelte'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { parseTerms } from '$lib/utils/text'

  interface Props {
    value: string[]
    onChange: (terms: string[]) => void
    id?: string
    placeholder?: string
    class?: string
    label?: string
    multiline?: boolean
  }

  let {
    value,
    onChange,
    id,
    placeholder,
    class: className,
    label,
    multiline = false,
  }: Props = $props()

  let text = $state(untrack(() => value.join(', ')))

  // Only an external change to `value` rewrites the text, never the user's own typing.
  $effect(() => {
    const external = value
    untrack(() => {
      const typed = parseTerms(text)
      if (typed.length !== external.length || typed.some((term, i) => term !== external[i])) {
        text = external.join(', ')
      }
    })
  })

  function handleInput(e: Event) {
    text = (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value
    onChange(parseTerms(text))
  }
</script>

{#if multiline}
  <Textarea {id} {placeholder} class={className} value={text} oninput={handleInput} />
{:else}
  <Input
    type="text"
    {id}
    {placeholder}
    class={className}
    {label}
    value={text}
    oninput={handleInput}
  />
{/if}
