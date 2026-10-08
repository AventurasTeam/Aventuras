import type { ImportDialogConfig } from '@/components/compounds/import-dialog'
import {
  avtsImportSlot,
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
    ...avtsImportSlot('entity'),
    schema: entityImportSchemaFor(kind),
    title: t(`world:import.title.${kind}`),
  }
}

export function loreImportDialog(): ImportDialogConfig<LoreImport> {
  return {
    ...avtsImportSlot('lore'),
    schema: LoreImportSchema,
    title: t('world:import.title.lore'),
  }
}
