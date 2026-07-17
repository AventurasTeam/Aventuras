import { useEffect, useState } from 'react'
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

function getModeOptions(): SelectOption[] {
  return [
    { value: 'do', label: t('reader:composerMode.do') },
    { value: 'say', label: t('reader:composerMode.say') },
    { value: 'think', label: t('reader:composerMode.think') },
    { value: 'free', label: t('reader:composerMode.free') },
  ]
}

// Long enough that a normal typing cadence never trips it — this fires only
// once the user has actually paused, not between keystrokes.
const LINT_DEBOUNCE_MS = 2000

export function Composer({
  modesEnabled,
  isGenerating,
  disabled = false,
  disabledReason,
  onSend,
  onCancel,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<ComposerMode>('free')
  const [lints, setLints] = useState<Lint[]>([])

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
      {modesEnabled ? (
        <Select
          options={getModeOptions()}
          value={mode}
          onValueChange={(value) => setMode(value as ComposerMode)}
          mode="segment"
          disabled={disabled}
        />
      ) : null}

      <View className="flex-row items-end gap-2">
        <View className="flex-1">
          <SpellcheckTextarea
            value={text}
            onChangeText={setText}
            editable={!disabled}
            placeholder={t('reader:composerPlaceholder')}
            lints={lints}
          />
        </View>

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

      {disabled && disabledReason != null && disabledReason.length > 0 ? (
        <Text size="xs" variant="muted">
          {disabledReason}
        </Text>
      ) : null}
    </View>
  )
}

export type { ComposerProps }
