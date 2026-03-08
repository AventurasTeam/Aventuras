<script lang="ts">
  import MainNarrative from '../MainNarrative.svelte'
  import AgentProfiles from '../AgentProfiles.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Slider } from '$lib/components/ui/slider'
  import {
    LLM_TIMEOUT_MIN,
    LLM_TIMEOUT_MAX,
    LLM_TIMEOUT_STEP,
    LLM_TIMEOUT_MIN_SECONDS,
    LLM_TIMEOUT_MAX_SECONDS,
  } from '$lib/constants/timeout'

  interface Props {
    onOpenManualBodyEditor: (title: string, value: string, onSave: (v: string) => void) => void
  }

  let { onOpenManualBodyEditor }: Props = $props()

  // Timeout slider state
  let timeoutValue = $derived(settings.apiSettings.llmTimeoutMs)

  function updateTimeout(v: number) {
    settings.setLlmTimeout(v)
  }
</script>

<div class="space-y-6">
  <!-- Global API Settings -->
  <Card>
    <CardHeader>
      <CardTitle>Global API Settings</CardTitle>
      <CardDescription>Settings that apply to all API requests</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <!-- Request Timeout -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="space-y-1">
            <Label>Request Timeout</Label>
            <p class="text-muted-foreground text-xs">
              Maximum time to wait for any LLM response (applies to all services)
            </p>
          </div>
          <span class="text-muted-foreground text-xs font-medium">
            {(settings.apiSettings.llmTimeoutMs / 1000).toFixed(0)}s
          </span>
        </div>
        <div class="flex items-center gap-4">
          <div class="flex flex-1 flex-col gap-4">
            <Slider
              type="single"
              value={timeoutValue}
              min={LLM_TIMEOUT_MIN}
              max={LLM_TIMEOUT_MAX}
              step={LLM_TIMEOUT_STEP}
              onValueChange={updateTimeout}
            />
            <div class="text-muted-foreground flex justify-between text-xs">
              <span>{LLM_TIMEOUT_MIN_SECONDS}s</span>
              <span>{Math.floor(LLM_TIMEOUT_MAX_SECONDS / 60)}min</span>
            </div>
          </div>
          <div>
            <Input
              type="number"
              class="h-9 w-24 text-left"
              value={Math.round(settings.apiSettings.llmTimeoutMs / 1000)}
              oninput={(e) => {
                const seconds = parseInt(e.currentTarget.value, 10)
                if (
                  !isNaN(seconds) &&
                  seconds >= LLM_TIMEOUT_MIN_SECONDS &&
                  seconds <= LLM_TIMEOUT_MAX_SECONDS
                ) {
                  settings.setLlmTimeout(seconds * 1000)
                }
              }}
              onchange={(e) => {
                const seconds = parseInt(e.currentTarget.value, 10)
                if (isNaN(seconds) || seconds < LLM_TIMEOUT_MIN_SECONDS) {
                  settings.setLlmTimeout(LLM_TIMEOUT_MIN)
                } else if (seconds > LLM_TIMEOUT_MAX_SECONDS) {
                  settings.setLlmTimeout(LLM_TIMEOUT_MAX)
                }
              }}
            />
          </div>
        </div>
      </div>
    </CardContent>
  </Card>

  <MainNarrative {onOpenManualBodyEditor} />
  <AgentProfiles />
</div>
