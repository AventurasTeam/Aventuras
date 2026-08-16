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
  onSave: (next: number) => Promise<void>
  onClose: () => void
}

export function WorldTimeEditSheet({
  frame,
  worldTimeRaw,
  monotonicityBreak,
  onSave,
  onClose,
}: WorldTimeEditSheetProps) {
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      ariaLabel={t('reader:worldTimeEdit.title')}
    >
      <SheetContent anchor="bottom" size="auto">
        {/* Keyed so an external worldTime change (undo, classifier write)
            reseeds the form, which only reads the prop on mount. */}
        <WorldTimeEditForm
          key={worldTimeRaw}
          frame={frame}
          worldTimeRaw={worldTimeRaw}
          monotonicityBreak={monotonicityBreak}
          onSave={(next) => void onSave(next)}
          onCancel={onClose}
        />
      </SheetContent>
    </Sheet>
  )
}

export type { WorldTimeEditSheetProps }
