<script lang="ts">
  import { templateEngine } from '$lib/services/templates/engine'
  import { getSamplesForTemplate } from './sampleContext'
  import { getVariablesForTemplate } from '$lib/services/templates/templateContextMap'
  import type { CustomVariable } from '$lib/services/packs/types'
  import type { TemplateContext, VariableType } from '$lib/services/templates/types'
  import { AlertTriangle } from 'lucide-svelte'

  interface Props {
    templateId: string
    content: string
    customVariables: CustomVariable[]
    hideHeader?: boolean
    testValues?: Record<string, string>
  }

  let { templateId, content, customVariables, hideHeader = false, testValues }: Props = $props()

  function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown) {
    const parts = path.split('.')
    let current: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {}
      }
      current = current[parts[i]] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }

  function parseOverride(value: string, type: VariableType | undefined): unknown {
    if (type === 'array' || type === 'object') {
      try {
        return JSON.parse(value)
      } catch {
        return undefined
      }
    }
    if (type === 'number') {
      const n = Number(value)
      return Number.isFinite(n) ? n : value
    }
    if (type === 'boolean') {
      return value === 'true'
    }
    return value
  }

  function buildSampleContext(
    vars: CustomVariable[],
    overrides?: Record<string, string>,
  ): TemplateContext {
    const context: TemplateContext = { ...getSamplesForTemplate(templateId) }
    const registryVars = getVariablesForTemplate(templateId)
    const typesByName = new Map(registryVars.map((v) => [v.name, v.type]))
    for (const v of registryVars) {
      if (!(v.name in context)) {
        context[v.name] = `[${v.name}]`
      }
    }
    // Custom pack variables: place under packVariables namespace
    for (const v of vars) {
      const path = 'packVariables.' + v.variableName
      setNestedValue(context, path, `[${v.displayName}]`)
    }
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (value === '') continue
        const parsed = parseOverride(value, typesByName.get(key))
        if (parsed === undefined) continue
        if (key.includes('.')) {
          setNestedValue(context, key, parsed)
        } else {
          context[key] = parsed
        }
      }
    }
    return context
  }

  // Debounced rendering
  let previewOutput = $state('')
  let previewError = $state('')
  let renderTimer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    // Track dependencies
    const currentContent = content
    const currentVars = customVariables
    const currentTestValues = testValues

    clearTimeout(renderTimer)
    renderTimer = setTimeout(() => {
      if (!currentContent.trim()) {
        previewOutput = ''
        previewError = ''
        return
      }

      const context = buildSampleContext(currentVars, currentTestValues)
      const result = templateEngine.render(currentContent, context)

      if (result === null) {
        previewError = 'Template could not be rendered. Check for syntax errors.'
        previewOutput = ''
      } else {
        previewOutput = result
        previewError = ''
      }
    }, 300)

    return () => clearTimeout(renderTimer)
  })
</script>

<div class="flex h-full flex-col overflow-hidden">
  {#if !hideHeader}
    <div class="border-b px-4 py-2">
      <h4 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Preview</h4>
    </div>
  {/if}

  <div class="flex-1 overflow-auto bg-[hsl(var(--muted)/0.3)] p-4">
    {#if previewError}
      <div class="flex items-start gap-2 text-sm text-yellow-500">
        <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
        <span>{previewError}</span>
      </div>
    {:else if previewOutput}
      <pre
        class="font-mono text-sm leading-relaxed break-words whitespace-pre-wrap text-[hsl(var(--foreground)/0.9)]">{previewOutput}</pre>
    {:else}
      <p class="text-muted-foreground text-sm italic">
        Start typing in the editor to see a preview...
      </p>
    {/if}
  </div>
</div>
