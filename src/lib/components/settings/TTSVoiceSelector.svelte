<script lang="ts">
  /**
   * One voice slot for the TTS panel.
   *
   * Each provider asks for a voice differently — free text for OpenAI-compatible
   * endpoints, the system voice list for Microsoft, a language list for Google — and
   * the panel now has two slots (narrator and dialogue). Written inline that is six
   * near-identical blocks to keep in step, which is what this component exists to
   * prevent.
   */
  import { Label } from '$lib/components/ui/label'
  import { Input } from '$lib/components/ui/input'
  import * as Select from '$lib/components/ui/select'
  import { Loader2 } from '@lucide/svelte'
  import { GOOGLE_TRANSLATE_LANGUAGES } from '$lib/services/ai/utils/TTSService'

  interface SystemVoice {
    name: string
    lang: string
  }

  interface Props {
    provider: 'openai' | 'google' | 'microsoft'
    value: string
    onChange: (voice: string) => void
    label: string
    /** Shown under the label; use it to say what this slot is for. */
    description?: string
    systemVoices: SystemVoice[]
    isLoadingVoices: boolean
    placeholder?: string
  }

  let {
    provider,
    value,
    onChange,
    label,
    description,
    systemVoices,
    isLoadingVoices,
    placeholder = 'alloy',
  }: Props = $props()
</script>

<div>
  <Label class="mb-1 block">{label}</Label>
  {#if description}
    <p class="text-muted-foreground mb-2 text-xs">{description}</p>
  {/if}

  {#if provider === 'openai'}
    <Input
      type="text"
      class="w-full"
      {value}
      oninput={(e) => onChange(e.currentTarget.value)}
      {placeholder}
    />
  {:else if provider === 'microsoft'}
    {#if isLoadingVoices}
      <div class="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 class="h-4 w-4 animate-spin" />
        Loading system voices...
      </div>
    {:else if systemVoices.length === 0}
      <div class="text-muted-foreground text-sm">
        No system voices found. Make sure you're running on Windows with TTS voices installed.
      </div>
    {:else}
      <Select.Root type="single" {value} onValueChange={(v) => onChange(v)}>
        <Select.Trigger class="h-10 w-full">
          {systemVoices.find((v) => v.name === value)?.name ?? 'Select system voice'}
        </Select.Trigger>
        <Select.Content>
          {#each systemVoices as voice (voice.name)}
            <Select.Item value={voice.name} label={voice.name}>
              {voice.name}
              <span class="text-muted-foreground ml-2 text-xs">({voice.lang})</span>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    {/if}
  {:else if provider === 'google'}
    <Select.Root type="single" {value} onValueChange={(v) => onChange(v)}>
      <Select.Trigger class="h-10 w-full">
        {GOOGLE_TRANSLATE_LANGUAGES.find((l) => l.id === value)?.name ?? 'Select language'}
      </Select.Trigger>
      <Select.Content>
        {#each GOOGLE_TRANSLATE_LANGUAGES as lang (lang.id)}
          <Select.Item value={lang.id} label={lang.name}>
            {lang.name}
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  {/if}
</div>
