import { beforeEach, describe, expect, it } from 'vitest'

import {
  emptyCastDraft,
  emptyWorkingState,
  type WizardCastDraft,
  type WizardCastDraftByKind,
} from '@/lib/db'
import { ID_PATTERN } from '@/lib/ids'

import { wizardStore } from './wizard'

// addCast returns the minted id; patchCast wants the row. Returning it narrowed
// to the concrete kind is what makes the cross-kind @ts-expect-error cases fire
// — a union-typed row would widen T straight back to the bag being guarded.
function addCastRow<K extends WizardCastDraft['kind']>(kind: K): WizardCastDraftByKind<K> {
  const id = wizardStore.addCast(kind)
  const row = wizardStore.getWizard().state.cast.find((r) => r.id === id)
  if (row?.kind !== kind) throw new Error(`no ${kind} row ${id}`)
  return row as WizardCastDraftByKind<K>
}

describe('wizardStore', () => {
  beforeEach(() => wizardStore.reset())

  it('starts empty on step 1', () => {
    expect(wizardStore.getWizard().state.step).toBe(1)
  })

  it('patchDefinition merges into the working-state', () => {
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    expect(wizardStore.getWizard().state.definition.mode).toBe('adventure')
    expect(wizardStore.getWizard().state.definition.narration).toBe('first')
    expect(wizardStore.getWizard().state.definition.title).toBe('')
  })

  it('patchOpening merges into the opening', () => {
    wizardStore.patchOpening({ content: 'Once.' })
    expect(wizardStore.getWizard().state.opening.content).toBe('Once.')
  })

  it('setEffectiveDim stores the dim and marks it touched (incl. Native/null)', () => {
    wizardStore.setEffectiveDim(1024)
    expect(wizardStore.getWizard().state.effectiveDim).toBe(1024)
    expect(wizardStore.getWizard().state.effectiveDimTouched).toBe(true)

    wizardStore.setEffectiveDim(null)
    expect(wizardStore.getWizard().state.effectiveDim).toBeNull()
    // An explicit Native pick still counts as touched, so the platform
    // pre-selection won't re-suggest it on a later disclosure remount.
    expect(wizardStore.getWizard().state.effectiveDimTouched).toBe(true)
  })

  it('reset clears the effectiveDim touched flag', () => {
    wizardStore.setEffectiveDim(512)
    wizardStore.reset()
    expect(wizardStore.getWizard().state.effectiveDimTouched).toBe(false)
    expect(wizardStore.getWizard().state.effectiveDim).toBeNull()
  })

  it('setStep updates the step', () => {
    wizardStore.setStep(2)
    expect(wizardStore.getWizard().state.step).toBe(2)
  })

  it('hydrate replaces the working-state (draft resume)', () => {
    wizardStore.setStep(3)
    wizardStore.patchDefinition({ mode: 'adventure' })

    const draft = { ...emptyWorkingState(), leadEntityId: 'char_resumed', step: 5 }
    wizardStore.hydrate(draft)

    expect(wizardStore.getWizard().state.leadEntityId).toBe('char_resumed')
    expect(wizardStore.getWizard().state.step).toBe(5)
    // Replaced wholesale, not merged — the local patchDefinition above is gone.
    expect(wizardStore.getWizard().state.definition.mode).toBe('creative')
  })

  it('reset returns to empty', () => {
    wizardStore.setLeadEntityId('char_x')
    wizardStore.setStep(2)
    const before = wizardStore.getWizard().state.definition
    wizardStore.reset()
    const after = wizardStore.getWizard().state.definition
    expect(wizardStore.getWizard().state.leadEntityId).toBeNull()
    expect(wizardStore.getWizard().state.step).toBe(1)
    expect(before).not.toBe(after)
  })

  it('a valid dim clears the invalid-draft flag', () => {
    wizardStore.setCustomDimInvalid(true)
    expect(wizardStore.getWizard().customDimInvalid).toBe(true)
    // Clearing lives inside setEffectiveDim, so every path that commits a dim —
    // ladder radio, Native, a corrected custom entry — releases the gate without
    // each caller having to remember to.
    wizardStore.setEffectiveDim(512)
    expect(wizardStore.getWizard().customDimInvalid).toBe(false)

    wizardStore.setCustomDimInvalid(true)
    wizardStore.setEffectiveDim(null)
    expect(wizardStore.getWizard().customDimInvalid).toBe(false)
  })

  it('the invalid-draft flag is ephemeral: reset and hydrate drop it', () => {
    wizardStore.setCustomDimInvalid(true)
    wizardStore.reset()
    expect(wizardStore.getWizard().customDimInvalid).toBe(false)

    wizardStore.setCustomDimInvalid(true)
    wizardStore.hydrate(wizardStore.getWizard().state)
    // A resumed draft persists the dim, never an unparseable keystroke.
    expect(wizardStore.getWizard().customDimInvalid).toBe(false)
  })
})

describe('lore mutators', () => {
  beforeEach(() => wizardStore.reset())

  it('addLore appends a row with a minted lore id and empty fields', () => {
    wizardStore.addLore()
    const [row] = wizardStore.getWizard().state.lore
    expect(row.id).toMatch(/^lore_/)
    expect(row.title).toBe('')
    expect(row.body).toBe('')
    expect(row.injectionMode).toBe('auto')
  })

  it('addLore returns the minted row id', () => {
    const id = wizardStore.addLore()
    const [row] = wizardStore.getWizard().state.lore
    expect(id).toBe(row.id)
  })

  it('patchLore updates only the addressed row', () => {
    wizardStore.addLore()
    wizardStore.addLore()
    const [first, second] = wizardStore.getWizard().state.lore
    expect(first.id).not.toBe(second.id)
    wizardStore.patchLore(second.id, { title: 'Second' })
    const after = wizardStore.getWizard().state.lore
    expect(after[0]).toBe(first)
    expect(after[1].title).toBe('Second')
  })

  it('removeLore drops the addressed row and keeps order', () => {
    wizardStore.addLore()
    wizardStore.addLore()
    wizardStore.addLore()
    const ids = wizardStore.getWizard().state.lore.map((r) => r.id)
    wizardStore.removeLore(ids[1])
    expect(wizardStore.getWizard().state.lore.map((r) => r.id)).toEqual([ids[0], ids[2]])
  })

  it('importLore appends a batch in one write', () => {
    wizardStore.addLore()
    wizardStore.importLore([
      { title: 'A', body: 'a' },
      { title: 'B', body: 'b' },
    ])
    const rows = wizardStore.getWizard().state.lore
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.title)).toEqual(['', 'A', 'B'])
    expect(new Set(rows.map((r) => r.id)).size, 'imported ids are distinct').toBe(3)
  })
})

describe('cast mutators', () => {
  beforeEach(() => wizardStore.reset())

  it.each([
    ['character', /^char_/],
    ['location', /^loc_/],
    ['item', /^item_/],
    ['faction', /^fact_/],
  ] as const)('addCast(%s) mints a substitutable, kind-prefixed id', (kind, prefix) => {
    const id = wizardStore.addCast(kind)
    expect(id).toMatch(prefix)
    expect(id).toMatch(ID_PATTERN)
    expect(wizardStore.getWizard().state.cast[0]).toMatchObject({ id, kind, status: 'active' })
  })

  it('patchCast patches the given row and leaves other rows alone', () => {
    const a = addCastRow('character')
    const b = addCastRow('character')
    wizardStore.patchCast(a, { name: 'Aria' })
    const cast = wizardStore.getWizard().state.cast
    expect(cast.find((r) => r.id === a.id)?.name).toBe('Aria')
    expect(cast.find((r) => r.id === b.id)?.name).toBe('')
  })

  it('rejects a status patch through patchCast at the type level; only setCastStatus carries the lead cascade', () => {
    const row = addCastRow('character')
    // @ts-expect-error status is excluded from the patch type — this line must
    // stop compiling if that exclusion is ever reverted.
    wizardStore.patchCast(row, { status: 'staged' })
    // The directive above is the assertion. Nothing is asserted about the
    // runtime write: JS has no gate today, but hardening one would be a fix,
    // not a regression, so pinning the current behavior would fight that.
    expect(wizardStore.getWizard().state.cast).toHaveLength(1)
  })

  it('rejects a cross-kind patch at the type level', () => {
    const character = addCastRow('character')
    const location = addCastRow('location')
    // @ts-expect-error parentLocationId belongs to a location, not a character.
    // Taking the ROW rather than its id is what lets T infer per-kind here; an
    // id-keyed patch typed as a union of Partials accepts any kind's field.
    wizardStore.patchCast(character, { parentLocationId: location.id })
    // @ts-expect-error voice belongs to a character, not a location.
    wizardStore.patchCast(location, { voice: 'clipped' })
    expect(wizardStore.getWizard().state.cast).toHaveLength(2)
  })

  it('importCast appends fully-built drafts unchanged', () => {
    const draft = emptyCastDraft('faction', 'fact_x')
    wizardStore.importCast([{ ...draft, name: 'Ashfall Pact' }])
    expect(wizardStore.getWizard().state.cast[0]).toMatchObject({
      id: 'fact_x',
      name: 'Ashfall Pact',
    })
  })

  it('setCastStatus to staged on the lead unsets the lead and reports it', () => {
    const id = wizardStore.addCast('character')
    wizardStore.setLeadEntityId(id)
    expect(wizardStore.setCastStatus(id, 'staged')).toBe(true)
    const s = wizardStore.getWizard().state
    expect(s.leadEntityId).toBeNull()
    expect(s.cast[0].status).toBe('staged')
  })

  it('setCastStatus on a non-lead stages only that row and leaves the lead set', () => {
    const lead = wizardStore.addCast('character')
    const other = wizardStore.addCast('character')
    wizardStore.setLeadEntityId(lead)
    expect(wizardStore.setCastStatus(other, 'staged')).toBe(false)
    const s = wizardStore.getWizard().state
    expect(s.leadEntityId).toBe(lead)
    expect(s.cast.find((r) => r.id === other)?.status).toBe('staged')
    expect(s.cast.find((r) => r.id === lead)?.status).toBe('active')
  })

  it('setCastStatus on an unknown id reports nothing and leaves a dangling lead alone', () => {
    const row = wizardStore.addCast('character')
    // The pointer names a row that is not in the cast — the shape a hydrated
    // draft can arrive in. Staging that id changes no row, so reporting `true`
    // would toast the user about an unset that never happened.
    wizardStore.setLeadEntityId('char_gone')
    expect(wizardStore.setCastStatus('char_gone', 'staged')).toBe(false)
    const s = wizardStore.getWizard().state
    expect(s.leadEntityId).toBe('char_gone')
    expect(s.cast).toHaveLength(1)
    expect(s.cast[0]).toMatchObject({ id: row, status: 'active' })
  })

  it("setCastStatus back to 'active' on the lead keeps the lead", () => {
    const lead = wizardStore.addCast('character')
    wizardStore.setLeadEntityId(lead)
    expect(wizardStore.setCastStatus(lead, 'active')).toBe(false)
    const s = wizardStore.getWizard().state
    expect(s.leadEntityId).toBe(lead)
    expect(s.cast[0].status).toBe('active')
  })

  it('removeCast on the lead unsets the lead and reports it', () => {
    const id = wizardStore.addCast('character')
    wizardStore.setLeadEntityId(id)
    expect(wizardStore.removeCast(id)).toBe(true)
    expect(wizardStore.getWizard().state.leadEntityId).toBeNull()
    expect(wizardStore.getWizard().state.cast).toHaveLength(0)
  })

  it('removeCast prunes only the refs that pointed at the removed row', () => {
    const doomedFac = wizardStore.addCast('faction')
    const keeperFac = wizardStore.addCast('faction')
    const doomedLoc = wizardStore.addCast('location')
    const keeperLoc = wizardStore.addCast('location')
    const orphanedRow = addCastRow('character')
    const attachedRow = addCastRow('character')
    const childOrphanedRow = addCastRow('location')
    const childAttachedRow = addCastRow('location')
    const { id: orphaned } = orphanedRow
    const { id: attached } = attachedRow
    const { id: childOrphaned } = childOrphanedRow
    const { id: childAttached } = childAttachedRow
    wizardStore.patchCast(orphanedRow, { factionId: doomedFac })
    wizardStore.patchCast(attachedRow, { factionId: keeperFac })
    wizardStore.patchCast(childOrphanedRow, { parentLocationId: doomedLoc })
    wizardStore.patchCast(childAttachedRow, { parentLocationId: keeperLoc })
    const attachedBefore = wizardStore.getWizard().state.cast.find((r) => r.id === attached)
    wizardStore.removeCast(doomedFac)
    wizardStore.removeCast(doomedLoc)
    const cast = wizardStore.getWizard().state.cast
    const by = (id: string) => cast.find((r) => r.id === id)
    expect(by(orphaned)).toMatchObject({ factionId: null })
    expect(by(childOrphaned)).toMatchObject({ parentLocationId: null })
    expect(by(attached)).toMatchObject({ factionId: keeperFac })
    expect(by(childAttached)).toMatchObject({ parentLocationId: keeperLoc })
    expect(by(attached), 'untouched rows keep identity').toBe(attachedBefore)
  })
})
