import { useState } from 'react'

import {
  WorldTimeEditForm,
  type MonotonicityBreak,
} from '@/components/compounds/world-time-edit-form'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import type { CalendarFrame } from '@/lib/calendar'
import { t } from '@/lib/i18n'

type WorldTimeEditSheetProps = {
  /** Stable reference required: the form's tuple memo keys on identity. */
  frame: CalendarFrame
  worldTimeRaw: number
  monotonicityBreak?: MonotonicityBreak
  onSave: (next: number) => Promise<boolean>
  onClose: () => void
}

export function WorldTimeEditSheet({
  frame,
  worldTimeRaw,
  monotonicityBreak,
  onSave,
  onClose,
}: WorldTimeEditSheetProps) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>()
  // Unsaved input holds the sheet: drag-down and tap-outside wait for Save or Cancel. Android
  // back still closes it through the primitive's BackHandler.
  const [dirty, setDirty] = useState(false)

  async function save(next: number) {
    if (saving) return
    setSaving(true)
    setSaveError(undefined)
    try {
      if (await onSave(next)) {
        onClose()
      } else {
        setSaveError(t('reader:worldTimeEdit.failed'))
      }
    } catch {
      setSaveError(t('reader:worldTimeEdit.failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next && !saving) onClose()
      }}
      ariaLabel={t('reader:worldTimeEdit.title')}
    >
      <SheetContent anchor="bottom" size="auto" dismissable={!saving && !dirty}>
        {/* Keyed so an external worldTime change (undo, classifier write)
            reseeds the form, which only reads the prop on mount. */}
        <WorldTimeEditForm
          key={worldTimeRaw}
          frame={frame}
          worldTimeRaw={worldTimeRaw}
          monotonicityBreak={monotonicityBreak}
          saving={saving}
          saveError={saveError}
          onSave={(next) => void save(next)}
          onCancel={onClose}
          onDirtyChange={setDirty}
        />
      </SheetContent>
    </Sheet>
  )
}

export type { WorldTimeEditSheetProps }
