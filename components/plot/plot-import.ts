import type { ImportDialogConfig } from '@/components/compounds/import-dialog'
import {
  AVTS_FORMATS,
  AVTS_SUPPORTED_MAJOR,
  HappeningImportSchema,
  ThreadImportSchema,
  type HappeningImport,
  type ThreadImport,
} from '@/lib/avts'
import { t } from '@/lib/i18n'

/** import-dialog.md → Plot per-row import. */
export function threadImportDialog(): ImportDialogConfig<ThreadImport> {
  return {
    format: AVTS_FORMATS.thread.format,
    supportedMajor: AVTS_SUPPORTED_MAJOR,
    payloadKey: AVTS_FORMATS.thread.payloadKey,
    schema: ThreadImportSchema,
    title: t('plot:import.title.thread'),
  }
}

export function happeningImportDialog(): ImportDialogConfig<HappeningImport> {
  return {
    format: AVTS_FORMATS.happening.format,
    supportedMajor: AVTS_SUPPORTED_MAJOR,
    payloadKey: AVTS_FORMATS.happening.payloadKey,
    schema: HappeningImportSchema,
    title: t('plot:import.title.happening'),
  }
}
