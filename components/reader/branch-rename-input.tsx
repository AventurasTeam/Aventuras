import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Platform, type TextInputKeyPressEvent } from 'react-native'

import { Input } from '@/components/ui/input'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'

export type BranchRenameInputProps = {
  /** The stored name, prefilled. */
  name: string
  /** The trimmed, non-empty, changed name; resolves once the write settles. A rejection is logged. */
  onSave: (name: string) => Promise<unknown>
  /** Collapse back to the row: after a save settles, a cancel, or an unchanged commit. */
  onDone: () => void
}

type Phase = 'editing' | 'saving' | 'settled'

// RN-Web's own submit guard reads both signals, and runs after this handler; 229 is the key code
// an IME's confirming Enter can carry with isComposing already false.
const IME_KEY_CODE = 229

// The caller's save may reject; the edit is over either way, so the failure is only logged.
const logRejection = (err: unknown) =>
  logger.error('reader.branch_rename_failed', {
    error: err instanceof Error ? err.message : String(err),
  })

const isComposing = ({ nativeEvent }: TextInputKeyPressEvent) =>
  ('isComposing' in nativeEvent && nativeEvent.isComposing === true) ||
  ('keyCode' in nativeEvent && nativeEvent.keyCode === IME_KEY_CODE)

/** A branch row's name as an input: Enter or blur saves a trimmed name, Esc cancels. */
export function BranchRenameInput({ name, onSave, onDone }: BranchRenameInputProps): ReactElement {
  const [draft, setDraft] = useState(name)
  const [invalid, setInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  // Enter, blur, Esc and an unmount can each end the edit; only the first one counts.
  const phase = useRef<Phase>('editing')
  const draftRef = useRef(name)
  // An untouched draft is the name at mount: saving it would overwrite a name changed since.
  const typed = useRef(false)
  const latest = useRef({ name, onSave })
  useEffect(() => {
    latest.current = { name, onSave }
  })

  // An unmount mid-edit, as when the navigator closes, saves a valid change and drops the rest.
  useEffect(
    () => () => {
      if (phase.current !== 'editing' || !typed.current) return
      const next = draftRef.current.trim()
      if (next === '' || next === latest.current.name.trim()) return
      phase.current = 'saving'
      void latest.current.onSave(next).catch(logRejection)
    },
    [],
  )

  const change = (text: string) => {
    draftRef.current = text
    typed.current = true
    setDraft(text)
    if (text.trim() !== '') setInvalid(false)
  }

  const commit = () => {
    if (phase.current !== 'editing') return
    const next = draftRef.current.trim()
    if (next === '') {
      setInvalid(true)
      return
    }
    if (!typed.current || next === name.trim()) {
      phase.current = 'settled'
      onDone()
      return
    }
    phase.current = 'saving'
    setSaving(true)
    void onSave(next).catch(logRejection).finally(onDone)
  }

  const cancel = () => {
    if (phase.current !== 'editing') return
    phase.current = 'settled'
    onDone()
  }

  const handleKeyPress = (event: TextInputKeyPressEvent) => {
    const { key } = event.nativeEvent
    if (isComposing(event)) return
    if (key === 'Escape') {
      event.preventDefault?.()
      cancel()
    } else if (key === 'Enter' && Platform.OS === 'web') {
      // RN-Web blurs after Enter whatever `submitBehavior` says; this keeps a refused name focused.
      event.preventDefault?.()
      commit()
    }
  }

  return (
    <Input
      size="sm"
      value={draft}
      onChangeText={change}
      onSubmitEditing={commit}
      submitBehavior="submit"
      onBlur={commit}
      onKeyPress={handleKeyPress}
      editable={!saving}
      aria-invalid={invalid}
      aria-label={t('reader:branches.renameInput')}
      autoFocus
      selectTextOnFocus
      returnKeyType="done"
    />
  )
}
