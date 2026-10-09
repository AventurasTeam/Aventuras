import { useState } from 'react'

import { UnsavedChangesDialog } from '@/components/compounds/unsaved-changes-dialog'
import {
  WorldTimeEditForm,
  type MonotonicityBreak,
} from '@/components/compounds/world-time-edit-form'
import { ABOVE_SHEETS_PORTAL_HOST, Sheet, SheetContent } from '@/components/ui/sheet'
import { useEditOverlayGuard } from '@/hooks/use-edit-overlay-guard'
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
  // Unsaved input holds the sheet: a scrim tap or Android back raises the guard, drag-down
  // snaps back.
  const guard = useEditOverlayGuard({ saving, saveError, onClose })

  async function save(next: number) {
    if (saving) return
    setSaving(true)
    setSaveError(undefined)
    try {
      if (await onSave(next)) {
        guard.close()
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
        if (!next && !saving) guard.close()
      }}
      ariaLabel={t('reader:worldTimeEdit.title')}
    >
      <SheetContent
        anchor="bottom"
        size="auto"
        dismissable={!guard.held}
        onDismissRefused={guard.requestClose}
      >
        {/* Keyed so an external worldTime change (undo, classifier write)
            reseeds the form, which only reads the prop on mount. */}
        <WorldTimeEditForm
          ref={guard.formRef}
          key={worldTimeRaw}
          frame={frame}
          worldTimeRaw={worldTimeRaw}
          monotonicityBreak={monotonicityBreak}
          saving={saving}
          saveError={saveError}
          onSave={(next) => void save(next)}
          onCancel={guard.close}
          onDraftChange={guard.onDraftChange}
        />
      </SheetContent>
      <UnsavedChangesDialog {...guard.dialog} portalHost={ABOVE_SHEETS_PORTAL_HOST} />
    </Sheet>
  )
}

export type { WorldTimeEditSheetProps }
