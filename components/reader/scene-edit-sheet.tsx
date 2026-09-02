import { useState } from 'react'

import {
  SceneEditForm,
  type SceneEdit,
  type SceneOptions,
} from '@/components/compounds/scene-edit-form'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { t } from '@/lib/i18n'

type SceneEditSheetProps = {
  sceneEntities: readonly string[]
  currentLocationId: string | null
  options: SceneOptions
  onSave: (next: SceneEdit) => Promise<boolean>
  onClose: () => void
}

/**
 * Phone tier only. The reader document requests; native presents — the card renders
 * no Sheet of its own (reader-document.md → Bridge contract).
 */
export function SceneEditSheet({
  sceneEntities,
  currentLocationId,
  options,
  onSave,
  onClose,
}: SceneEditSheetProps) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>()

  async function save(next: SceneEdit) {
    if (saving) return
    setSaving(true)
    setSaveError(undefined)
    try {
      if (await onSave(next)) {
        onClose()
      } else {
        setSaveError(t('reader:sceneEdit.failed'))
      }
    } catch {
      setSaveError(t('reader:sceneEdit.failed'))
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
      ariaLabel={t('reader:sceneEdit.title')}
    >
      {/* Fixed detent, not `auto`: the scene list needs its own BottomSheetScrollView,
          and `auto` wraps content in a BottomSheetView that captures vertical pan and
          starves nested scrollables (sheet.tsx). */}
      <SheetContent anchor="bottom" size="tall" enablePanDownToClose={!saving}>
        {/* Keyed so an external scene change (undo, classifier write) reseeds the
            form, which only reads its props on mount. */}
        <SceneEditForm
          insideSheet
          key={`${sceneEntities.join(',')}|${currentLocationId ?? ''}`}
          sceneEntities={sceneEntities}
          currentLocationId={currentLocationId}
          options={options}
          saving={saving}
          saveError={saveError}
          onSave={(next) => void save(next)}
          onCancel={onClose}
        />
      </SheetContent>
    </Sheet>
  )
}

export type { SceneEditSheetProps }
