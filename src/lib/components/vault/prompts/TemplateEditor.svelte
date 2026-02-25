<script lang="ts">
  import CodeMirror from 'svelte-codemirror-editor'
  import { liquid } from '@codemirror/lang-liquid'
  import { EditorView } from '@codemirror/view'
  import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
  import { tags } from '@lezer/highlight'
  import type { Extension } from '@codemirror/state'
  import { database } from '$lib/services/database'
  import { packService } from '$lib/services/packs/pack-service'
  import { validateTemplate } from '$lib/services/templates/validator'
  import { variableRegistry } from '$lib/services/templates/variables'
  import type { ValidationError } from '$lib/services/templates/types'
  import type { CustomVariable } from '$lib/services/packs/types'
  import type { Completion } from '@codemirror/autocomplete'
  import { AlertTriangle, CircleCheck, FlaskConical } from 'lucide-svelte'
  import { Button } from '$lib/components/ui/button'
  import TemplatePreview from './TemplatePreview.svelte'
  import { createIsMobile } from '$lib/hooks/is-mobile.svelte'

  interface Props {
    packId: string
    templateId: string
    customVariables: CustomVariable[]
    activeTab?: 'system' | 'user'
    mobileView?: 'editor' | 'preview'
    testValues?: Record<string, string>
    hasCustomVariables?: boolean
    onTestVarsOpen?: () => void
    onDirtyChange?: (dirty: boolean) => void
    onActiveTabChange?: (tab: 'system' | 'user') => void
    onHasUserContent?: (has: boolean) => void
  }

  let {
    packId,
    templateId,
    customVariables,
    activeTab = 'system',
    mobileView = 'editor',
    testValues = {},
    hasCustomVariables = false,
    onTestVarsOpen,
    onDirtyChange,
    onActiveTabChange,
    onHasUserContent,
  }: Props = $props()

  // Editor content state
  let systemContent = $state('')
  let userContent = $state('')
  let originalSystem = $state('')
  let originalUser = $state('')
  let hasUserContent = $state(false)
  let validationErrors = $state<ValidationError[]>([])
  let editorView = $state<EditorView | null>(null)
  let loading = $state(true)

  const isMobile = createIsMobile()

  // Dirty tracking
  let isSystemDirty = $derived(systemContent !== originalSystem)
  let isUserDirty = $derived(userContent !== originalUser)
  let isDirty = $derived(isSystemDirty || isUserDirty)

  // Notify parent of dirty state changes
  $effect(() => {
    onDirtyChange?.(isDirty)
  })

  // Build variable completions for CodeMirror autocomplete
  let completions: Completion[] = $derived.by(() => {
    const result: Completion[] = []
    for (const v of variableRegistry.getAll()) {
      result.push({
        label: v.name,
        type: 'variable',
        detail: v.category,
        info: v.description,
      })
    }
    for (const v of customVariables) {
      result.push({
        label: v.variableName,
        type: 'variable',
        detail: 'custom',
        info: v.displayName,
      })
    }
    return result
  })

  // Build liquid language extension
  let liquidLang = $derived(liquid({ variables: completions }))

  // Custom theme using app CSS variables
  const editorTheme: Extension = EditorView.theme({
    '&': {
      fontSize: '14px',
      height: '100%',
    },
    '.cm-content': {
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      padding: '12px 0',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--surface-100, var(--muted))',
      borderRight: '1px solid var(--border)',
      color: 'var(--muted-foreground)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--surface-200, var(--accent))',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
    },
    '.cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 50%, transparent) !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--primary) 40%, transparent) !important',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--foreground)',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
    // Autocomplete dropdown container
    '.cm-tooltip-autocomplete': {
      backgroundColor: 'var(--popover, hsl(217 33% 17%))',
      color: 'var(--popover-foreground, hsl(210 40% 98%))',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    },
    // Individual completion item
    '.cm-tooltip-autocomplete ul li': {
      color: 'var(--popover-foreground, hsl(210 40% 98%))',
    },
    // Selected/highlighted completion item
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: 'var(--accent-foreground)',
    },
    // Completion label (main text)
    '.cm-completionLabel': {
      color: 'inherit',
    },
    // Completion detail text (category)
    '.cm-completionDetail': {
      color: 'var(--muted-foreground, hsl(215 20% 65%))',
      fontStyle: 'italic',
      marginLeft: '8px',
    },
    // Completion info tooltip (description)
    '.cm-tooltip.cm-completionInfo': {
      backgroundColor: 'var(--popover, hsl(217 33% 17%))',
      color: 'var(--popover-foreground, hsl(210 40% 98%))',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      padding: '8px 12px',
      maxWidth: '300px',
    },
    // Completion icon
    '.cm-completionIcon': {
      color: 'var(--color-accent-400, #60a5fa)',
      opacity: '1',
    },
    // Matched characters in completion (bold highlight)
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      fontWeight: '600',
      color: 'var(--color-accent-300, #93c5fd)',
    },
    // General tooltip styling (also affects hover tooltips)
    '.cm-tooltip': {
      backgroundColor: 'var(--popover, hsl(217 33% 17%))',
      color: 'var(--popover-foreground, hsl(210 40% 98%))',
      border: '1px solid var(--border)',
    },
  })

  // Syntax highlighting for Liquid template tokens
  const liquidHighlightStyle = HighlightStyle.define([
    // Liquid output delimiters: {{ and }}
    { tag: tags.brace, color: 'var(--color-accent-500, #3b82f6)' },
    // Liquid tag delimiters: {% and %}
    { tag: tags.angleBracket, color: 'var(--color-accent-500, #3b82f6)' },
    // Variable names inside {{ }}
    { tag: tags.variableName, color: 'var(--color-accent-400, #60a5fa)', fontWeight: '500' },
    // Liquid keywords: if, else, endif, for, endfor, unless, case, etc.
    { tag: tags.keyword, color: 'var(--color-accent-300, #93c5fd)' },
    // Liquid tag names (e.g., assign, capture, comment)
    { tag: tags.tagName, color: 'var(--color-accent-300, #93c5fd)' },
    // Operators: ==, !=, contains, and, or
    { tag: tags.operator, color: 'var(--color-accent-400, #60a5fa)' },
    // Strings in Liquid expressions
    { tag: tags.string, color: '#a5d6a7' },
    // Numbers in Liquid expressions
    { tag: tags.number, color: '#ffcc80' },
    // Boolean values: true, false, nil
    { tag: tags.bool, color: '#ffcc80' },
    // Filter names after |
    { tag: tags.function(tags.variableName), color: '#ce93d8' },
    // Property access (dot notation)
    { tag: tags.propertyName, color: 'var(--color-accent-400, #60a5fa)' },
    // Comments
    { tag: tags.comment, color: 'var(--color-surface-500, #64748b)', fontStyle: 'italic' },
    // HTML tags (since Liquid wraps HTML)
    { tag: tags.typeName, color: 'var(--color-surface-300, #cbd5e1)' },
    // HTML attribute names
    { tag: tags.attributeName, color: 'var(--color-accent-400, #60a5fa)' },
    // HTML attribute values
    { tag: tags.attributeValue, color: '#a5d6a7' },
  ])

  // Combined extensions: editor theme + syntax highlighting
  const editorExtensions: Extension[] = [editorTheme, syntaxHighlighting(liquidHighlightStyle)]

  // Debounced validation
  let validationTimer: ReturnType<typeof setTimeout> | undefined

  function validateContent(content: string) {
    clearTimeout(validationTimer)
    validationTimer = setTimeout(() => {
      const additionalVarNames = customVariables.map((v) => v.variableName)
      const result = validateTemplate(content, additionalVarNames)
      validationErrors = result.errors
    }, 500)
  }

  // Load template content when templateId changes
  $effect(() => {
    const tId = templateId
    const pId = packId
    loadTemplate(pId, tId)
  })

  async function loadTemplate(pId: string, tId: string) {
    loading = true
    validationErrors = []
    editorView = null

    try {
      // Load system prompt
      const systemTemplate = await database.getPackTemplate(pId, tId)
      const sysContent = systemTemplate?.content ?? ''
      systemContent = sysContent
      originalSystem = sysContent

      // Load user message (if exists)
      const userTemplate = await database.getPackTemplate(pId, `${tId}-user`)
      if (userTemplate) {
        userContent = userTemplate.content
        originalUser = userTemplate.content
        hasUserContent = true
      } else {
        userContent = ''
        originalUser = ''
        hasUserContent = false
      }

      onHasUserContent?.(hasUserContent)
      onActiveTabChange?.('system')
      // Run initial validation
      validateContent(sysContent)
    } catch (error) {
      console.error('[TemplateEditor] Failed to load template:', error)
    } finally {
      loading = false
    }
  }

  function handleContentChange(newValue: string) {
    if (activeTab === 'system') {
      systemContent = newValue
    } else {
      userContent = newValue
    }
    validateContent(newValue)
  }

  function handleEditorReady(view: EditorView) {
    editorView = view
  }

  export function insertVariable(variableName: string) {
    if (!editorView) return
    const insertion = `{{ ${variableName} }}`
    const cursor = editorView.state.selection.main.head
    editorView.dispatch({
      changes: { from: cursor, insert: insertion },
      selection: { anchor: cursor + insertion.length },
    })
    editorView.focus()
  }

  // Current content for the active tab
  let currentContent = $derived(activeTab === 'system' ? systemContent : userContent)

  // Public methods for parent component
  export async function save(): Promise<boolean> {
    try {
      await database.setPackTemplateContent(packId, templateId, systemContent)
      originalSystem = systemContent

      if (hasUserContent) {
        await database.setPackTemplateContent(packId, `${templateId}-user`, userContent)
        originalUser = userContent
      }
      return true
    } catch (error) {
      console.error('[TemplateEditor] Failed to save:', error)
      return false
    }
  }

  export function discard(): void {
    systemContent = originalSystem
    userContent = originalUser
    validateContent(activeTab === 'system' ? systemContent : userContent)
  }

  export async function reset(): Promise<boolean> {
    const resetSystem = await packService.resetTemplate(packId, templateId)
    if (!resetSystem) return false

    if (hasUserContent) {
      await packService.resetTemplate(packId, `${templateId}-user`)
    }

    // Reload from database
    await loadTemplate(packId, templateId)
    return true
  }
</script>

{#if loading}
  <div class="flex h-full items-center justify-center">
    <p class="text-muted-foreground text-sm">Loading template...</p>
  </div>
{:else}
  <div class="flex h-full flex-col overflow-hidden">
    <!-- Editor + Preview content area -->
    <div class="flex min-h-0 flex-1 {isMobile.current ? 'flex-col' : 'flex-row'}">
      <!-- Editor column (label + CodeMirror) -->
      <div
        class="flex min-h-0 flex-col overflow-hidden {isMobile.current ? 'flex-1' : 'flex-1'}"
        class:hidden={isMobile.current && mobileView === 'preview'}
      >
        {#if !isMobile.current}
          <div class="border-b px-4 py-2">
            <h4 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Editor
            </h4>
          </div>
        {/if}

        <!-- CodeMirror Editor -->
        <div class="min-h-0 flex-1 overflow-hidden">
          {#key `${templateId}-${activeTab}`}
            <CodeMirror
              class="h-full"
              value={currentContent}
              onchange={handleContentChange}
              lang={liquidLang}
              theme={editorExtensions}
              lineWrapping
              lineNumbers
              onready={handleEditorReady}
              styles={{
                '&': { height: '100%' },
              }}
            />
          {/key}
        </div>
      </div>

      <!-- Preview column -->
      <div
        class="min-h-0 overflow-hidden {isMobile.current ? 'flex-1' : 'w-[45%] border-l'}"
        class:hidden={isMobile.current && mobileView === 'editor'}
      >
        <TemplatePreview
          content={currentContent}
          {customVariables}
          hideHeader={isMobile.current}
          {testValues}
        />
      </div>
    </div>

    <!-- Validation bar (full width) -->
    <div class="flex items-center justify-between border-t px-4 py-2">
      <div class="min-w-0 flex-1">
        {#if validationErrors.length > 0}
          <div class="flex flex-col gap-1">
            {#each validationErrors as error (error.message)}
              <div class="flex items-start gap-2 text-xs">
                <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-500" />
                <span class="text-muted-foreground">
                  {error.message}
                  {#if error.line}
                    <span class="text-muted-foreground/70">(line {error.line})</span>
                  {/if}
                </span>
              </div>
            {/each}
          </div>
        {:else}
          <div class="flex items-center gap-2 text-xs">
            <CircleCheck class="h-3.5 w-3.5 text-green-500" />
            <span class="text-muted-foreground">Template is valid</span>
          </div>
        {/if}
      </div>

      {#if hasCustomVariables && onTestVarsOpen}
        <Button
          variant="ghost"
          size="sm"
          class="ml-2 h-7 shrink-0 gap-1.5 text-xs"
          onclick={onTestVarsOpen}
        >
          <FlaskConical class="h-3.5 w-3.5" />
          Test Variables
        </Button>
      {/if}
    </div>
  </div>
{/if}
