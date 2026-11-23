// Not a runtime test (no .test.ts) — `pnpm typecheck` validates it. The public
// per-store namespaces (generationStore, …) are plain selector/mutator objects;
// a raw zustand vanilla handle must never leak onto the lib/stores surface. If
// one does, Leaked becomes non-never and the assertion below fails to compile.
//
// `import type * as` is the only way to obtain the full module-export type
// without inline `import()` annotations (banned by consistent-type-imports).
// eslint-disable-next-line no-restricted-syntax
import type * as StoresIndex from '@/lib/stores'
import {
  chaptersStore,
  characterRelationshipsStore,
  entitiesStore,
  entriesStore,
  eraFlipsStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  loreStore,
  threadsStore,
  translationsStore,
} from '@/lib/stores'

type PublicApi = typeof StoresIndex
// A raw zustand vanilla store exposes setState/getState/subscribe; the public
// namespaces expose named selectors + mutators and never these handles.
type RawStoreLike = { setState: unknown; getState: unknown; subscribe: unknown }
type Leaked = {
  [K in keyof PublicApi]: PublicApi[K] extends RawStoreLike ? K : never
}[keyof PublicApi]

export const _assertNoStoreHandleLeak: [Leaked] extends [never]
  ? true
  : ['LEAKED — a raw zustand store handle is exported from lib/stores', Leaked] = true

// A working-set read names its branch: each unscoped form fails to compile, beside its scoped
// form, which compiles. Never called; named as a hook since it calls hooks.
export function useBranchReadPins(): void {
  // @ts-expect-error a row read names its branch
  entitiesStore.getEntities()
  entitiesStore.getEntities('br')
  // @ts-expect-error a row hook names its branch
  entitiesStore.useEntities((m) => m)
  entitiesStore.useEntities('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  entitiesStore.getById('x')
  entitiesStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  entitiesStore.useById('x')
  entitiesStore.useById('br', 'x')
  // @ts-expect-error a row read names its branch
  entriesStore.getEntries()
  entriesStore.getEntries('br')
  // @ts-expect-error a row hook names its branch
  entriesStore.useEntries((m) => m)
  entriesStore.useEntries('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  entriesStore.getById('x')
  entriesStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  entriesStore.useById('x')
  entriesStore.useById('br', 'x')
  // @ts-expect-error a row read names its branch
  loreStore.getLore()
  loreStore.getLore('br')
  // @ts-expect-error a row hook names its branch
  loreStore.useLore((m) => m)
  loreStore.useLore('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  loreStore.getById('x')
  loreStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  loreStore.useById('x')
  loreStore.useById('br', 'x')
  // @ts-expect-error a row read names its branch
  threadsStore.getThreads()
  threadsStore.getThreads('br')
  // @ts-expect-error a row hook names its branch
  threadsStore.useThreads((m) => m)
  threadsStore.useThreads('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  threadsStore.getById('x')
  threadsStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  threadsStore.useById('x')
  threadsStore.useById('br', 'x')
  // @ts-expect-error a row read names its branch
  chaptersStore.getChapters()
  chaptersStore.getChapters('br')
  // @ts-expect-error a row hook names its branch
  chaptersStore.useChapters((m) => m)
  chaptersStore.useChapters('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  chaptersStore.getById('x')
  chaptersStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  chaptersStore.useById('x')
  chaptersStore.useById('br', 'x')
  // @ts-expect-error a row read names its branch
  happeningsStore.getHappenings()
  happeningsStore.getHappenings('br')
  // @ts-expect-error a row hook names its branch
  happeningsStore.useHappenings((m) => m)
  happeningsStore.useHappenings('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  happeningsStore.getById('x')
  happeningsStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  happeningsStore.useById('x')
  happeningsStore.useById('br', 'x')
  // @ts-expect-error a row read names its branch
  happeningInvolvementsStore.getInvolvements()
  happeningInvolvementsStore.getInvolvements('br')
  // @ts-expect-error a row hook names its branch
  happeningInvolvementsStore.useInvolvements((m) => m)
  happeningInvolvementsStore.useInvolvements('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  happeningInvolvementsStore.getById('x')
  happeningInvolvementsStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  happeningInvolvementsStore.useById('x')
  happeningInvolvementsStore.useById('br', 'x')
  // @ts-expect-error a row read names its branch
  happeningAwarenessStore.getAwareness()
  happeningAwarenessStore.getAwareness('br')
  // @ts-expect-error a row hook names its branch
  happeningAwarenessStore.useAwareness((m) => m)
  happeningAwarenessStore.useAwareness('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  happeningAwarenessStore.getById('x')
  happeningAwarenessStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  happeningAwarenessStore.useById('x')
  happeningAwarenessStore.useById('br', 'x')
  // @ts-expect-error a row read names its branch
  characterRelationshipsStore.getRelationshipRows()
  characterRelationshipsStore.getRelationshipRows('br')
  // @ts-expect-error a row hook names its branch
  characterRelationshipsStore.useRelationships((m) => m)
  characterRelationshipsStore.useRelationships('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  characterRelationshipsStore.getById('x')
  characterRelationshipsStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  characterRelationshipsStore.useById('x')
  characterRelationshipsStore.useById('br', 'x')
  // @ts-expect-error a row read names its branch
  translationsStore.getTranslations()
  translationsStore.getTranslations('br')
  // @ts-expect-error a row hook names its branch
  translationsStore.useTranslations((m) => m)
  translationsStore.useTranslations('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  translationsStore.getById('x')
  translationsStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  translationsStore.useById('x')
  translationsStore.useById('br', 'x')
  // @ts-expect-error a row read names its branch
  eraFlipsStore.getEraFlips()
  eraFlipsStore.getEraFlips('br')
  // @ts-expect-error a row hook names its branch
  eraFlipsStore.useEraFlips((m) => m)
  eraFlipsStore.useEraFlips('br', (m) => m)
  // @ts-expect-error a read by id names its branch
  eraFlipsStore.getById('x')
  eraFlipsStore.getById('br', 'x')
  // @ts-expect-error a hook by id names its branch
  eraFlipsStore.useById('x')
  eraFlipsStore.useById('br', 'x')
  // @ts-expect-error a derived getter names its branch
  chaptersStore.getLatest()
  chaptersStore.getLatest('br')
  // @ts-expect-error a derived getter names its branch
  chaptersStore.getBySequenceNumber(1)
  chaptersStore.getBySequenceNumber('br', 1)
  // @ts-expect-error a derived getter names its branch
  entitiesStore.getByKind('character')
  entitiesStore.getByKind('br', 'character')
  // @ts-expect-error a derived getter names its branch
  happeningInvolvementsStore.getByHappening('hap')
  happeningInvolvementsStore.getByHappening('br', 'hap')
  // @ts-expect-error a derived getter names its branch
  happeningAwarenessStore.getByHappening('hap')
  happeningAwarenessStore.getByHappening('br', 'hap')
  // @ts-expect-error a derived getter names its branch
  happeningAwarenessStore.getByCharacter('char')
  happeningAwarenessStore.getByCharacter('br', 'char')
  // @ts-expect-error a derived getter names its branch
  translationsStore.getTranslation('entity', 'x', 'name', 'en')
  translationsStore.getTranslation('br', 'entity', 'x', 'name', 'en')
  // @ts-expect-error a derived getter names its branch
  characterRelationshipsStore.getRelationships('char')
  characterRelationshipsStore.getRelationships('char', 'br')
}
