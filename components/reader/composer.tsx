import { forwardRef, useEffect, useImperativeHandle, useState, type ForwardedRef } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import type { ComposerMode } from '@/lib/composer-wrap'
import { t } from '@/lib/i18n'
import { lintNarrativeText } from '@/lib/spellcheck'

import { SpellcheckTextarea } from './spellcheck-textarea'

type Lint = Awaited<ReturnType<typeof lintNarrativeText>>[number]

type ComposerProps = {
  /** Caller ANDs `stories.settings.composerModesEnabled` with `mode !== 'creative'`. */
  modesEnabled: boolean
  isGenerating: boolean
  disabled?: boolean
  disabledReason?: string
  onSend: (rawText: string, mode: ComposerMode) => void
  onCancel: () => void
}

type ComposerHandle = {
  /** Refill the input (e.g. after a cancelled turn) so the user can edit/re-send. */
  restoreDraft: (text: string, mode: ComposerMode) => void
}

function getModeOptions(): SelectOption[] {
  return [
    {
      value: 'do',
      label: t('reader:composerMode.do'),
      description: t('reader:composerModeHint.do'),
    },
    {
      value: 'say',
      label: t('reader:composerMode.say'),
      description: t('reader:composerModeHint.say'),
    },
    {
      value: 'think',
      label: t('reader:composerMode.think'),
      description: t('reader:composerModeHint.think'),
    },
    {
      value: 'free',
      label: t('reader:composerMode.free'),
      description: t('reader:composerModeHint.free'),
    },
  ]
}

// Long enough that a normal typing cadence never trips it — this fires only
// once the user has actually paused, not between keystrokes.
const LINT_DEBOUNCE_MS = 2000

export const Composer = forwardRef(function Composer(
  { modesEnabled, isGenerating, disabled = false, disabledReason, onSend, onCancel }: ComposerProps,
  ref: ForwardedRef<ComposerHandle>,
) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<ComposerMode>('free')
  const [lints, setLints] = useState<Lint[]>([])

  useImperativeHandle(
    ref,
    () => ({
      restoreDraft: (nextText, nextMode) => {
        setText(nextText)
        setMode(nextMode)
      },
    }),
    [],
  )

  useEffect(() => {
    if (text.trim().length === 0) {
      setLints([])
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      void lintNarrativeText(text).then((result) => {
        if (!cancelled) setLints(result)
      })
    }, LINT_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [text])

  const canSend = text.trim().length > 0
  const sendDisabled = disabled || !canSend

  function handleSubmit() {
    if (!canSend) return
    onSend(text, modesEnabled ? mode : 'free')
    setText('')
    setLints([])
  }

  return (
    <View className="gap-2">
      <SpellcheckTextarea
        value={text}
        onChangeText={setText}
        editable={!disabled}
        placeholder={t('reader:composerPlaceholder')}
        lints={lints}
      />

      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-1.5">
          {modesEnabled ? (
            <Select
              options={getModeOptions()}
              value={mode}
              onValueChange={(value) => setMode(value as ComposerMode)}
              mode="dropdown"
              size="sm"
              disabled={disabled || isGenerating}
              label={t('reader:composerModeLabel')}
              renderTrigger={({ selected }) => (
                <View className="flex-row items-baseline gap-1.5">
                  <Text size="xs" variant="muted" className="uppercase tracking-wider">
                    {t('reader:composerModeLabel')}
                  </Text>
                  <Text size="sm" className="font-medium">
                    {selected?.label}
                  </Text>
                </View>
              )}
              renderRow={({ option, selected }) => (
                <View className="flex-1">
                  <Text size="sm" className={selected ? 'font-semibold' : undefined}>
                    {option.label}
                  </Text>
                  {option.description != null ? (
                    <Text size="xs" variant="muted">
                      {option.description}
                    </Text>
                  ) : null}
                </View>
              )}
            />
          ) : null}
        </View>

        <View className="flex-row items-center gap-1.5">
          {isGenerating ? (
            <Button variant="destructive" onPress={onCancel}>
              <Text>{t('cancel')}</Text>
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={sendDisabled}
              accessibilityHint={disabled ? disabledReason : undefined}
              onPress={handleSubmit}
            >
              <Text>{t('reader:send')}</Text>
            </Button>
          )}
        </View>
      </View>

      {disabled && disabledReason != null && disabledReason.length > 0 ? (
        <Text size="xs" variant="muted">
          {disabledReason}
        </Text>
      ) : null}
    </View>
  )
})

export type { ComposerHandle, ComposerProps }
