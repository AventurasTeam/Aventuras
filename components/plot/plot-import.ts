import type { ImportDialogConfig } from '@/components/compounds/import-dialog'
import {
  avtsImportSlot,
  HappeningImportSchema,
  ThreadImportSchema,
  type HappeningImport,
  type ThreadImport,
} from '@/lib/avts'
import { t } from '@/lib/i18n'

/** import-dialog.md → Plot per-row import. */
export function threadImportDialog(): ImportDialogConfig<ThreadImport> {
  return {
    ...avtsImportSlot('thread'),
    schema: ThreadImportSchema,
    title: t('plot:import.title.thread'),
  }
}

export function happeningImportDialog(): ImportDialogConfig<HappeningImport> {
  return {
    ...avtsImportSlot('happening'),
    schema: HappeningImportSchema,
    title: t('plot:import.title.happening'),
  }
}
