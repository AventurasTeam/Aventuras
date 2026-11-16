import type { Delta } from '@/lib/db'
import { formatEntryRef } from '@/lib/entry-refs'
import { humanizeDelta, type HistoryRow, type HistoryTable } from '@/lib/history'
import { t } from '@/lib/i18n'
import {
  chaptersStore,
  characterRelationshipsStore,
  entitiesStore,
  entriesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  loreStore,
  threadsStore,
} from '@/lib/stores'
import {
  UNDO_LINK_TABLES,
  UNDO_NAMED_TABLES,
  type UndoDescription,
  type UndoRowRef,
} from '@/lib/undo'

export type UndoPlace = 'menu' | 'title' | 'notice' | 'redoMenu' | 'redoNotice'

export type UnseenUndoDescription = Extract<UndoDescription, { seen: false }>

/** What a description's ids read as, History's way; null when it can't be read. */
export type UndoNames = {
  entryRef: (entryId: string) => string | null
  chapterNumber: (chapterId: string) => number | null
  rowName: (row: UndoRowRef) => string | null
}

type Row = Record<string, unknown>

const HISTORY_OWN: ReadonlySet<string> = new Set(['entities', 'lore', 'threads', 'happenings'])

const ROW_KEY: Record<'create' | 'update' | 'delete', 'created' | 'edited' | 'deleted'> = {
  create: 'created',
  update: 'edited',
  delete: 'deleted',
}

// Literal keys, one whole sentence per place: languages move the verb, so no target is spliced in.
const SENTENCES = {
  menu: {
    turn: 'reader:undo.menu.turn',
    entryText: 'reader:undo.menu.entryText',
    entryScene: 'reader:undo.menu.entryScene',
    entryTime: 'reader:undo.menu.entryTime',
    suggestionRefresh: 'reader:undo.menu.suggestionRefresh',
    close: 'reader:undo.menu.close',
    rerun: 'reader:undo.menu.rerun',
    keptClose: 'reader:undo.menu.keptClose',
    created: 'reader:undo.menu.created',
    deleted: 'reader:undo.menu.deleted',
    edited: 'reader:undo.menu.edited',
    rows: 'reader:undo.menu.rows',
    latest: 'reader:undo.menu.latest',
  },
  title: {
    close: 'reader:undo.title.close',
    rerun: 'reader:undo.title.rerun',
    keptClose: 'reader:undo.title.keptClose',
    created: 'reader:undo.title.created',
    deleted: 'reader:undo.title.deleted',
    edited: 'reader:undo.title.edited',
    rows: 'reader:undo.title.rows',
    latest: 'reader:undo.title.latest',
  },
  notice: {
    turn: 'reader:undo.notice.turn',
    entryText: 'reader:undo.notice.entryText',
    entryScene: 'reader:undo.notice.entryScene',
    entryTime: 'reader:undo.notice.entryTime',
    suggestionRefresh: 'reader:undo.notice.suggestionRefresh',
    close: 'reader:undo.notice.close',
    rerun: 'reader:undo.notice.rerun',
    keptClose: 'reader:undo.notice.keptClose',
    created: 'reader:undo.notice.created',
    deleted: 'reader:undo.notice.deleted',
    edited: 'reader:undo.notice.edited',
    rows: 'reader:undo.notice.rows',
    latest: 'reader:undo.notice.latest',
  },
  redoMenu: {
    turn: 'reader:undo.redoMenu.turn',
    entryText: 'reader:undo.redoMenu.entryText',
    entryScene: 'reader:undo.redoMenu.entryScene',
    entryTime: 'reader:undo.redoMenu.entryTime',
    suggestionRefresh: 'reader:undo.redoMenu.suggestionRefresh',
    close: 'reader:undo.redoMenu.close',
    rerun: 'reader:undo.redoMenu.rerun',
    keptClose: 'reader:undo.redoMenu.keptClose',
    created: 'reader:undo.redoMenu.created',
    deleted: 'reader:undo.redoMenu.deleted',
    edited: 'reader:undo.redoMenu.edited',
    rows: 'reader:undo.redoMenu.rows',
    latest: 'reader:undo.redoMenu.latest',
  },
  redoNotice: {
    turn: 'reader:undo.redoNotice.turn',
    entryText: 'reader:undo.redoNotice.entryText',
    entryScene: 'reader:undo.redoNotice.entryScene',
    entryTime: 'reader:undo.redoNotice.entryTime',
    suggestionRefresh: 'reader:undo.redoNotice.suggestionRefresh',
    close: 'reader:undo.redoNotice.close',
    rerun: 'reader:undo.redoNotice.rerun',
    keptClose: 'reader:undo.redoNotice.keptClose',
    created: 'reader:undo.redoNotice.created',
    deleted: 'reader:undo.redoNotice.deleted',
    edited: 'reader:undo.redoNotice.edited',
    rows: 'reader:undo.redoNotice.rows',
    latest: 'reader:undo.redoNotice.latest',
  },
} as const

type SentenceKey = keyof (typeof SENTENCES)['menu']
type TitleKey = keyof (typeof SENTENCES)['title']
type FullPlace = Exclude<UndoPlace, 'title'>
type Params = Record<string, string | number>

/** A target's sentence with its names filled in, or null when a name can't be read. */
type Phrase = { key: SentenceKey; params: Params } | null

function entryPhrase(key: SentenceKey, entryId: string, names: UndoNames): Phrase {
  const entry = names.entryRef(entryId)
  return entry == null ? null : { key, params: { entry } }
}

function phraseOf(description: UndoDescription, names: UndoNames): Phrase {
  switch (description.kind) {
    case 'turn':
      return entryPhrase('turn', description.entryId, names)
    case 'tagged':
      return entryPhrase(description.undoKind, description.entryId, names)
    case 'keptClose':
      return description.entryId == null
        ? null
        : entryPhrase('keptClose', description.entryId, names)
    case 'close':
    case 'rerun': {
      const number = names.chapterNumber(description.chapterId)
      return number == null ? null : { key: description.kind, params: { number } }
    }
    case 'row': {
      const name = names.rowName(description.row)
      return name == null ? null : { key: ROW_KEY[description.op], params: { name } }
    }
    case 'rows': {
      const name = names.rowName(description.first)
      return name == null ? null : { key: 'rows', params: { name, count: description.more } }
    }
    case 'latest':
      return { key: 'latest', params: {} }
  }
}

/**
 * The sentence an undo or redo target reads as in `place`: the menu label or the notice. A target
 * whose names can't be read falls to `the latest change`, which an Undo label closes with `…`.
 */
export function undoTargetText(
  description: UndoDescription,
  names: UndoNames,
  place: FullPlace,
): string {
  const phrase = phraseOf(description, names) ?? { key: 'latest', params: {} }
  return t(SENTENCES[place][phrase.key], phrase.params)
}

function isTitleKey(key: SentenceKey): key is TitleKey {
  return key in SENTENCES.title
}

/** The confirm's title, `Undo <target>?`; only an unseen target confirms. */
export function undoConfirmTitle(description: UnseenUndoDescription, names: UndoNames): string {
  const phrase = phraseOf(description, names)
  if (phrase == null || !isTitleKey(phrase.key)) return t(SENTENCES.title.latest)
  return t(SENTENCES.title[phrase.key], phrase.params)
}

/** Where a row's fields are read: the working set, a delete's payload, or a redo snapshot. */
export type UndoRowSource = (row: UndoRowRef) => Row | undefined

const LIVE: Record<string, (id: string) => object | undefined> = {
  entities: entitiesStore.getById,
  lore: loreStore.getById,
  threads: threadsStore.getById,
  happenings: happeningsStore.getById,
  chapters: chaptersStore.getById,
  character_relationships: characterRelationshipsStore.getById,
  happening_involvements: happeningInvolvementsStore.getById,
  happening_awareness: happeningAwarenessStore.getById,
}

/** A row in the open story's working set. */
export const liveUndoRow: UndoRowSource = ({ table, id }) => LIVE[table]?.(id) as Row | undefined

/** A gone row as the group's delete captured it (delete-cascade.ts: the payload is the row). */
export function deletedRowsOf(deltas: readonly Delta[]): UndoRowSource {
  return ({ table, id }) =>
    deltas.find((d) => d.op === 'delete' && d.targetTable === table && d.targetId === id)
      ?.undoPayload ?? undefined
}

/** Tries each source in turn. */
export function firstRowOf(...sources: UndoRowSource[]): UndoRowSource {
  return (row) => {
    for (const source of sources) {
      const found = source(row)
      if (found != null) return found
    }
    return undefined
  }
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/** A link row's entity end, the side History's tab of that entity shows it from. */
function entityEndOf(table: string, row: Row): string | null {
  if (table === 'character_relationships') return str(row.aId)
  if (table === 'happening_awareness') return str(row.characterId)
  if (table === 'happening_involvements') return str(row.entityId)
  return null
}

function otherEndOf(table: string, row: Row): UndoRowRef | null {
  if (table === 'character_relationships') {
    const id = str(row.bId)
    return id == null ? null : { table: 'entities', id }
  }
  const id = str(row.happeningId)
  return id == null ? null : { table: 'happenings', id }
}

/**
 * Names and entry numbers as History reads them (world.md → History tab): a row's display name,
 * `chapter N` for a chapter, a link row by its entity end, and an entry as `entry #n`.
 */
export function undoNames(
  rows: UndoRowSource,
  entryPositions: Readonly<Record<string, number>> = {},
): UndoNames {
  const rowName = (ref: UndoRowRef): string | null => {
    if (!UNDO_NAMED_TABLES.has(ref.table)) return null
    const row = rows(ref)
    if (row == null) return null
    if (ref.table === 'entities') return str(row.name)
    if (ref.table === 'chapters')
      return typeof row.sequenceNumber === 'number'
        ? t('reader:undo.chapterName', { number: row.sequenceNumber })
        : null
    if (UNDO_LINK_TABLES.has(ref.table)) {
      const entity = entityEndOf(ref.table, row)
      return entity == null ? null : rowName({ table: 'entities', id: entity })
    }
    return str(row.title)
  }
  return {
    rowName,
    entryRef: (entryId) => {
      const position =
        entryPositions[entryId] ??
        entriesStore.getById(entryId)?.position ??
        rows({ table: 'story_entries', id: entryId })?.position
      return typeof position === 'number' ? formatEntryRef(position) : null
    },
    chapterNumber: (chapterId) => {
      const number = rows({ table: 'chapters', id: chapterId })?.sequenceNumber
      return typeof number === 'number' ? number : null
    },
  }
}

const CONFIRM_ROWS = 5

function humanized(delta: Delta, via: HistoryRow['via'], table: HistoryTable, name: string) {
  return humanizeDelta(
    { delta, via },
    {
      targetTable: table,
      targetName: name,
      otherName: () => null,
      entryLabel: () => null,
      nowMs: 0,
    },
  )
}

function confirmLine(delta: Delta, names: UndoNames, rows: UndoRowSource): string | null {
  const ref = { table: delta.targetTable, id: delta.targetId }
  const name = names.rowName(ref)
  if (name == null) return null
  if (HISTORY_OWN.has(ref.table)) {
    const view = humanized(delta, { kind: 'own' }, ref.table as HistoryTable, name)
    return t('reader:undo.row', { row: view.targetDisplayName, change: view.summary })
  }
  if (ref.table === 'chapters') {
    const change =
      delta.op === 'create'
        ? t('history:summary.created')
        : delta.op === 'delete'
          ? t('history:summary.deleted')
          : t('history:summary.modifiedUnknown')
    return t('reader:undo.row', { row: name, change })
  }
  const row = rows(ref)
  const other = row == null ? null : otherEndOf(ref.table, row)
  if (row == null || other == null) return null
  const otherName = names.rowName(other)
  const view = humanizeDelta(
    {
      delta,
      via:
        ref.table === 'character_relationships'
          ? {
              kind: 'link',
              table: 'character_relationships',
              linkId: ref.id,
              otherId: other.id,
              side: 'a',
            }
          : {
              kind: 'link',
              table: ref.table as 'happening_involvements' | 'happening_awareness',
              linkId: ref.id,
              otherId: other.id,
              side: null,
            },
    },
    {
      targetTable: 'entities',
      targetName: name,
      otherName: () => otherName,
      entryLabel: () => null,
      nowMs: 0,
    },
  )
  return t('reader:undo.row', {
    row: t('reader:undo.linkRow', { name, link: view.targetDisplayName }),
    change: view.summary,
  })
}

/**
 * The confirm's body for a target other than a close: up to five of the group's rows as History
 * names them, oldest first, then `and N more` for the rest, entry writes and rows it can't name
 * included.
 */
export function undoConfirmRows(
  deltas: readonly Delta[],
  names: UndoNames,
  rows: UndoRowSource,
): string[] {
  const lines: string[] = []
  for (const delta of [...deltas].reverse()) {
    if (lines.length === CONFIRM_ROWS) break
    const line = confirmLine(delta, names, rows)
    if (line != null) lines.push(line)
  }
  const more = deltas.length - lines.length
  return more > 0 ? [...lines, t('reader:undo.moreRows', { count: more })] : lines
}
