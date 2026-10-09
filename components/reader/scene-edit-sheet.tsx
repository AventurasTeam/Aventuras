import { useState } from 'react'

import {
  SceneEditForm,
  type SceneEdit,
  type SceneOptions,
  sceneSaveErrorKey,
  type SceneSaveResult,
} from '@/components/compounds/scene-edit-form'
import { UnsavedChangesDialog } from '@/components/compounds/unsaved-changes-dialog'
import { ABOVE_SHEETS_PORTAL_HOST, Sheet, SheetContent } from '@/components/ui/sheet'
import { useEditOverlayGuard } from '@/hooks/use-edit-overlay-guard'
import { t } from '@/lib/i18n'

type SceneEditSheetProps = {
  sceneEntities: readonly string[]
  currentLocationId: string | null
  options: SceneOptions
  onSave: (next: SceneEdit) => Promise<SceneSaveResult>
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
  // Unsaved input holds the sheet: a scrim tap or Android back raises the guard, drag-down
  // snaps back.
  const guard = useEditOverlayGuard({ saving, saveError, onClose })

  async function save(next: SceneEdit) {
    if (saving) return
    setSaving(true)
    setSaveError(undefined)
    try {
      const result = await onSave(next)
      if (result.ok) {
        guard.close()
      } else {
        setSaveError(t(sceneSaveErrorKey(result.code)))
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
        if (!next && !saving) guard.close()
      }}
      ariaLabel={t('reader:sceneEdit.title')}
    >
      {/* Fixed detent, not `auto`: the scene list needs its own BottomSheetScrollView,
          and `auto` wraps content in a BottomSheetView that captures vertical pan and
          starves nested scrollables (sheet.tsx). */}
      <SheetContent
        anchor="bottom"
        size="tall"
        dismissable={!guard.held}
        onDismissRefused={guard.requestClose}
      >
        {/* Keyed so an external scene change (undo, classifier write) reseeds the
            form, which only reads its props on mount. */}
        <SceneEditForm
          ref={guard.formRef}
          insideSheet
          key={`${sceneEntities.join(',')}|${currentLocationId ?? ''}`}
          sceneEntities={sceneEntities}
          currentLocationId={currentLocationId}
          options={options}
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

export type { SceneEditSheetProps }
