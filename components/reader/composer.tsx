import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import type { ComposerMode } from '@/lib/composer-wrap'
import { t } from '@/lib/i18n'
import { lintNarrativeText } from '@/lib/spellcheck'

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

const LINT_DEBOUNCE_MS = 400

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
  const [spellcheckOn, setSpellcheckOn] = useState(false)
  const [lints, setLints] = useState<Lint[]>([])

  useEffect(() => {
    if (!spellcheckOn || text.trim().length === 0) {
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
  }, [text, spellcheckOn])

  const canSend = text.trim().length > 0
  const sendDisabled = disabled || !canSend

  function handleSubmit() {
    if (!canSend) return
    onSend(text, modesEnabled ? mode : 'free')
    setText('')
    setLints([])
  }

  const spellcheckStatus =
    lints.length === 0
      ? t('reader:spellcheckClean')
      : t('reader:spellcheckIssues', { count: lints.length })

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

      <Textarea
        value={text}
        onChangeText={setText}
        editable={!disabled}
        placeholder={t('reader:composerPlaceholder')}
      />

      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <Button
            variant={spellcheckOn ? 'secondary' : 'ghost'}
            size="sm"
            disabled={disabled}
            accessibilityState={{ checked: spellcheckOn }}
            onPress={() => setSpellcheckOn((on) => !on)}
          >
            <Text>{t('reader:spellcheck')}</Text>
          </Button>
          {spellcheckOn ? (
            <Text size="xs" variant="muted">
              {spellcheckStatus}
            </Text>
          ) : null}
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
