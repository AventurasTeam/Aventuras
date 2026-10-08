import type { ImportDialogConfig } from '@/components/compounds/import-dialog'
import {
  AVTS_FORMATS,
  AVTS_SUPPORTED_MAJOR,
  entityImportSchemaFor,
  LoreImportSchema,
  type EntityImport,
  type LoreImport,
} from '@/lib/avts'
import type { EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'

/** import-dialog.md → World per-row entity import: the slot's schema is narrowed to its kind. */
export function entityImportDialog(kind: EntityKind): ImportDialogConfig<EntityImport> {
  return {
    format: AVTS_FORMATS.entity.format,
    supportedMajor: AVTS_SUPPORTED_MAJOR,
    payloadKey: AVTS_FORMATS.entity.payloadKey,
    schema: entityImportSchemaFor(kind),
    title: t(`world:import.title.${kind}`),
  }
}

export function loreImportDialog(): ImportDialogConfig<LoreImport> {
  return {
    format: AVTS_FORMATS.lore.format,
    supportedMajor: AVTS_SUPPORTED_MAJOR,
    payloadKey: AVTS_FORMATS.lore.payloadKey,
    schema: LoreImportSchema,
    title: t('world:import.title.lore'),
  }
}
