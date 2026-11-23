import type { StorePatch } from '@/lib/actions'
import type { Translation } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

// U+0000 cannot occur in a kind, a kind_uuid id, a dotted field path, or an ISO-639-1 lang.
const SEP = '\u0000'
const compositeKey = (kind: string, id: string, field: string, language: string): string =>
  `${kind}${SEP}${id}${SEP}${field}${SEP}${language}`

const base = createWorkingSetStore<Translation>()
let index = new Map<string, string>()

// Rebuild from the base rows — base holds only the loaded branch and branch-guards its own
// writes, so this auto-inherits the branch guard with no duplicated logic or ordering hazard.
function rebuildIndex(): void {
  index = new Map()
  for (const r of base.getRows(base.getLoadedBranch()).values()) {
    if (r.translatedText != null)
      index.set(compositeKey(r.targetKind, r.targetId, r.field, r.language), r.translatedText)
  }
}

export const translationsStore = {
  getLoadedBranch: base.getLoadedBranch,
  useTranslations: base.useRows,
  getTranslations: base.getRows,
  getById: base.getById,
  useById: base.useById,
  // The index holds the loaded branch's rows alone, so any other branch reads as a miss.
  getTranslation: (
    branchId: string | null,
    kind: Translation['targetKind'],
    id: string,
    field: string,
    language: string,
  ): string | undefined =>
    branchId != null && base.getLoadedBranch() === branchId
      ? index.get(compositeKey(kind, id, field, language))
      : undefined,
  hydrate: (branchId: string, rows: Translation[]): void => {
    base.hydrate(branchId, rows)
    rebuildIndex()
  },
  patch: (branchId: string, patch: StorePatch): void => {
    base.patch(branchId, patch)
    rebuildIndex()
  },
  __reset: (): void => {
    base.__reset()
    index = new Map()
  },
}
