import type { PipelineAction } from '@/lib/actions'
import type { Entity, EntityKind } from '@/lib/db'
import { normalizeTerm } from '@/lib/keyword-terms'

type EntityUpdate = Extract<PipelineAction, { kind: 'updateEntity' }>

/** The classifier's namesake rule: same kind, same normalizeTerm name. */
export function namesakeKey(entity: Pick<Entity, 'kind' | 'name'>): string {
  return `${entity.kind}:${normalizeTerm(entity.name)}`
}

/**
 * Whether a row outside `exclude` already answers to `name` under the namesake rule (staged and
 * retired rows count): world.md → Rename's hint, which warns and never blocks.
 */
export function nameTakenByOther(input: {
  kind: EntityKind
  name: string
  /** The branch's entities. */
  entities: readonly Entity[]
  exclude: ReadonlySet<string>
}): boolean {
  if (input.name.trim() === '') return false
  const key = namesakeKey({ kind: input.kind, name: input.name })
  return input.entities.some((e) => !input.exclude.has(e.id) && namesakeKey(e) === key)
}

function countKeys(rows: Iterable<Pick<Entity, 'kind' | 'name'>>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = namesakeKey(row)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * Flagged rows the write leaves with no same-kind namesake although they had one before: World
 * can't pair them, so their flag could never be cleared. Rows already orphaned stay untouched.
 */
export function orphanedFlags(input: {
  /** The branch's entities before the write. */
  entities: readonly Entity[]
  removed?: ReadonlySet<string>
  /** id → new name. */
  renamed?: ReadonlyMap<string, string>
}): string[] {
  const { entities, removed = new Set<string>(), renamed = new Map<string, string>() } = input
  const after = (e: Entity) => ({ kind: e.kind, name: renamed.get(e.id) ?? e.name })
  const before = countKeys(entities)
  const left = countKeys(entities.filter((e) => !removed.has(e.id)).map(after))
  return entities
    .filter(
      (e) =>
        e.nameCollisionFlag === 1 &&
        !removed.has(e.id) &&
        (before.get(namesakeKey(e)) ?? 0) > 1 &&
        (left.get(namesakeKey(after(e))) ?? 0) <= 1,
    )
    .map((e) => e.id)
}

function isUserUpdateOf(action: PipelineAction, id: string): action is EntityUpdate {
  return action.kind === 'updateEntity' && action.source === 'user_edit' && action.payload.id === id
}

/**
 * `actions` with each id's flag cleared: folded into that row's first user `updateEntity` (one
 * delta per row), else appended as its own update. A repeated id folds into its earlier clear.
 */
export function withFlagClears(
  actions: readonly PipelineAction[],
  branchId: string,
  ids: readonly string[],
): PipelineAction[] {
  const out = [...actions]
  for (const id of ids) {
    const index = out.findIndex((action) => isUserUpdateOf(action, id))
    const update = out[index]
    if (index === -1 || !isUserUpdateOf(update, id)) {
      out.push({
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId, id, patch: { nameCollisionFlag: 0 } },
      })
      continue
    }
    out[index] = {
      ...update,
      payload: { ...update.payload, patch: { ...update.payload.patch, nameCollisionFlag: 0 } },
    }
  }
  return out
}
