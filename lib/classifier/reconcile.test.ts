import { describe, expect, it, vi } from 'vitest'

import type { Entity } from '@/lib/db'

import {
  cosine,
  decideReconcile,
  reconcileNewCharacter,
  TAU_HIGH,
  TAU_LOW,
  type EmbedDescriptions,
  type ScoredNamesake,
} from './reconcile'

// The decision reads id / kind / name / description / status / keywords, and the
// partner order reads nameCollisionFlag / createdAt.
const row = (over: Partial<Entity> = {}): Entity =>
  ({
    id: 'char_1',
    branchId: 'branch_1',
    kind: 'character',
    name: 'Eldrin',
    description: 'A tavern keeper with ink-stained hands.',
    status: 'active',
    keywords: [],
    nameCollisionFlag: 0,
    createdAt: 1,
    ...over,
  }) as unknown as Entity

const namesake = (
  id: string,
  match: ScoredNamesake['match'],
  similarity: number | null,
  inScene = false,
  over: Partial<Entity> = {},
): ScoredNamesake => ({ entity: row({ id, ...over }), match, similarity, inScene })

const flagOf = (partnerId: string, reason: string) => ({
  kind: 'create',
  flag: { partnerId, reason },
})

// classifier.md -> Disambiguation -> Decision: the first row that applies wins.
describe('decideReconcile', () => {
  describe('row 1: absorb into the best exact namesake', () => {
    it('promotes a staged exact namesake at or above TAU_HIGH', () => {
      expect(
        decideReconcile([namesake('char_a', 'exact', TAU_HIGH, false, { status: 'staged' })]),
      ).toEqual({
        kind: 'promote',
        entityId: 'char_a',
        similarity: TAU_HIGH,
      })
    })

    it('treats an active or retired exact namesake as a known mention', () => {
      expect(decideReconcile([namesake('char_a', 'exact', 0.9)])).toEqual({
        kind: 'known',
        entityId: 'char_a',
        similarity: 0.9,
      })
      expect(
        decideReconcile([namesake('char_r', 'exact', 0.9, false, { status: 'retired' })]),
      ).toEqual({
        kind: 'known',
        entityId: 'char_r',
        similarity: 0.9,
      })
    })

    it('absorbs an in-scene exact namesake in the ambiguous band, TAU_LOW included', () => {
      expect(decideReconcile([namesake('char_a', 'exact', 0.6, true)])).toMatchObject({
        kind: 'known',
        entityId: 'char_a',
      })
      expect(decideReconcile([namesake('char_a', 'exact', TAU_LOW, true)])).toMatchObject({
        kind: 'known',
        entityId: 'char_a',
      })
    })

    it('absorbs the highest-scoring qualifying row, not the first or the in-scene one', () => {
      expect(
        decideReconcile([
          namesake('char_scene', 'exact', 0.6, true),
          namesake('char_high', 'exact', 0.8),
        ]),
      ).toMatchObject({ kind: 'known', entityId: 'char_high' })
    })

    it('breaks a score tie between absorbable rows by the partner order', () => {
      expect(
        decideReconcile([
          namesake('char_out', 'exact', 0.9),
          namesake('char_in', 'exact', 0.9, true),
        ]),
      ).toMatchObject({ kind: 'known', entityId: 'char_in' })
    })

    it('never absorbs a partial namesake, however alike: it flags alike from TAU_HIGH', () => {
      expect(decideReconcile([namesake('char_a', 'partial', 0.95, true)])).toEqual(
        flagOf('char_a', 'alike'),
      )
      expect(decideReconcile([namesake('char_a', 'partial', TAU_HIGH)])).toEqual(
        flagOf('char_a', 'alike'),
      )
    })
  })

  describe('row 2: any exact namesake flags', () => {
    it('flags an exact namesake in the ambiguous band outside the scene', () => {
      expect(decideReconcile([namesake('char_a', 'exact', 0.6)])).toEqual(
        flagOf('char_a', 'ambiguous'),
      )
    })

    it('flags a low-scoring exact namesake as distinct, even in the scene', () => {
      expect(decideReconcile([namesake('char_a', 'exact', 0.2)])).toEqual(
        flagOf('char_a', 'distinct'),
      )
      expect(decideReconcile([namesake('char_a', 'exact', 0.49, true)])).toEqual(
        flagOf('char_a', 'distinct'),
      )
    })

    it('flags an unscored exact namesake as no-signal', () => {
      expect(decideReconcile([namesake('char_a', 'exact', null)])).toEqual(
        flagOf('char_a', 'no-signal'),
      )
    })

    // The exact row decides that a flag is set; the partner is still the first qualifier.
    it('pairs the flag with a scored partial qualifier ahead of an unscored exact row', () => {
      expect(
        decideReconcile([
          namesake('char_exact', 'exact', null),
          namesake('char_part', 'partial', 0.6),
        ]),
      ).toEqual(flagOf('char_part', 'ambiguous'))
    })
  })

  describe('row 3: a partial namesake with a second signal flags', () => {
    it('flags at or above TAU_LOW', () => {
      expect(decideReconcile([namesake('char_a', 'partial', TAU_LOW)])).toEqual(
        flagOf('char_a', 'ambiguous'),
      )
    })

    it('flags a low-scoring partial namesake in the scene as in-scene', () => {
      expect(decideReconcile([namesake('char_a', 'partial', 0.1, true)])).toEqual(
        flagOf('char_a', 'in-scene'),
      )
    })

    it('flags an unscored partial namesake as no-signal', () => {
      expect(decideReconcile([namesake('char_a', 'partial', null)])).toEqual(
        flagOf('char_a', 'no-signal'),
      )
    })
  })

  describe('row 4: otherwise create unflagged', () => {
    it('creates plain for a low-scoring partial namesake outside the scene', () => {
      expect(decideReconcile([namesake('char_a', 'partial', 0.49)])).toEqual({
        kind: 'create',
        flag: null,
      })
    })

    it('creates plain with no namesakes', () => {
      expect(decideReconcile([])).toEqual({ kind: 'create', flag: null })
    })
  })

  // classifier.md -> Partner and reason. Each case ties every earlier key, puts the expected
  // partner second, and differs in exactly one key.
  describe('partner order', () => {
    it('ranks by score, highest first', () => {
      expect(
        decideReconcile([namesake('char_lo', 'partial', 0.6), namesake('char_hi', 'partial', 0.7)]),
      ).toEqual(flagOf('char_hi', 'ambiguous'))
    })

    it('ranks the unscored last', () => {
      expect(
        decideReconcile([
          namesake('char_none', 'partial', null),
          namesake('char_lo', 'partial', 0.55),
        ]),
      ).toEqual(flagOf('char_lo', 'ambiguous'))
    })

    it('then ranks the in-scene first', () => {
      expect(
        decideReconcile([
          namesake('char_out', 'partial', 0.6),
          namesake('char_in', 'partial', 0.6, true),
        ]),
      ).toEqual(flagOf('char_in', 'ambiguous'))
    })

    it('then ranks exact before partial', () => {
      expect(
        decideReconcile([
          namesake('char_part', 'partial', 0.6),
          namesake('char_exact', 'exact', 0.6),
        ]),
      ).toEqual(flagOf('char_exact', 'ambiguous'))
    })

    it('then ranks an unflagged row before a flagged one', () => {
      expect(
        decideReconcile([
          namesake('char_flagged', 'exact', 0.3, false, { nameCollisionFlag: 1 }),
          namesake('char_plain', 'exact', 0.3),
        ]),
      ).toEqual(flagOf('char_plain', 'distinct'))
    })

    it('then ranks the older row first', () => {
      expect(
        decideReconcile([
          namesake('char_new', 'exact', 0.3, false, { createdAt: 5 }),
          namesake('char_old', 'exact', 0.3, false, { createdAt: 2 }),
        ]),
      ).toEqual(flagOf('char_old', 'distinct'))
    })

    it('then ranks by id', () => {
      expect(
        decideReconcile([namesake('char_b', 'exact', null), namesake('char_a', 'exact', null)]),
      ).toEqual(flagOf('char_a', 'no-signal'))
    })
  })
})

// Candidate is texts[0]; every other text scores the similarity scripted for it.
function embedder(similarityOf: Record<string, number>) {
  return vi.fn<EmbedDescriptions>(async (texts) => ({
    vectors: texts.map((text, i) => {
      if (i === 0) return new Float32Array([1, 0])
      const s = similarityOf[text]
      if (s === undefined) throw new Error(`no similarity scripted for ${JSON.stringify(text)}`)
      return new Float32Array([s, Math.sqrt(1 - s ** 2)])
    }),
    dim: 2,
  }))
}

const KEEPER = 'A tavern keeper with ink-stained hands.'
const candidate = (
  over: Partial<{ name: string; description: string; keywords: string[] }> = {},
) => ({
  name: 'Eldrin',
  description: 'The keeper, ink on his hands.',
  keywords: [],
  ...over,
})

describe('reconcileNewCharacter', () => {
  it('creates plain with no embed call when no character is a namesake', async () => {
    const embed = embedder({})
    const decision = await reconcileNewCharacter(candidate({ name: 'John' }), {
      entities: [row({ name: 'Johnson' }), row({ id: 'loc_1', kind: 'location', name: 'John' })],
      embedDescriptions: embed,
      scene: null,
    })
    expect(decision).toEqual({ kind: 'create', flag: null })
    expect(embed).not.toHaveBeenCalled()
  })

  it('matches an exact namesake across case, spacing and NFC spellings', async () => {
    const spaced = await reconcileNewCharacter(candidate({ name: '  ELDRIN ' }), {
      entities: [row({ name: 'Eldrin' })],
      embedDescriptions: embedder({ [KEEPER]: 0.9 }),
      scene: null,
    })
    expect(spaced).toEqual({ kind: 'known', entityId: 'char_1', similarity: 0.9 })
    const decomposed = await reconcileNewCharacter(candidate({ name: 'Zoë' }), {
      entities: [row({ name: 'Zoë' })],
      embedDescriptions: embedder({ [KEEPER]: 0.9 }),
      scene: null,
    })
    expect(decomposed).toEqual({ kind: 'known', entityId: 'char_1', similarity: 0.9 })
  })

  it('treats a contained name as a partial namesake, which never absorbs', async () => {
    const decision = await reconcileNewCharacter(candidate(), {
      entities: [row({ name: 'Eldrin Vane' })],
      embedDescriptions: embedder({ [KEEPER]: 0.9 }),
      scene: null,
    })
    expect(decision).toEqual(flagOf('char_1', 'alike'))
  })

  it("treats a hit on either side's keywords as a partial namesake", async () => {
    const innkeeper = await reconcileNewCharacter(
      candidate({ name: 'Marta', keywords: ['the innkeeper'] }),
      {
        entities: [row({ name: 'The Innkeeper' })],
        embedDescriptions: embedder({ [KEEPER]: 0.6 }),
        scene: null,
      },
    )
    expect(innkeeper).toEqual(flagOf('char_1', 'ambiguous'))
    const wolf = await reconcileNewCharacter(candidate({ name: 'the Grey Wolf' }), {
      entities: [row({ name: 'Aric', keywords: ['The Grey Wolf'] })],
      embedDescriptions: embedder({ [KEEPER]: 0.6 }),
      scene: null,
    })
    expect(wolf).toEqual(flagOf('char_1', 'ambiguous'))
  })

  it('embeds the candidate with every namesake in one call and scores each', async () => {
    const embed = embedder({ 'A blacksmith.': 0, [KEEPER]: 1 })
    const decision = await reconcileNewCharacter(candidate(), {
      entities: [
        row({ id: 'char_decoy', description: 'A blacksmith.' }),
        row({ id: 'char_real', description: KEEPER }),
      ],
      embedDescriptions: embed,
      scene: null,
    })
    expect(decision).toMatchObject({ kind: 'known', entityId: 'char_real' })
    expect(embed).toHaveBeenCalledTimes(1)
    expect(embed).toHaveBeenCalledWith(['The keeper, ink on his hands.', 'A blacksmith.', KEEPER])
  })

  it('leaves a namesake with a blank description unscored, and out of the call', async () => {
    const embed = embedder({ [KEEPER]: 0.2 })
    const decision = await reconcileNewCharacter(candidate(), {
      entities: [
        row({ id: 'char_blank', description: '   ', createdAt: 0 }),
        row({ id: 'char_null', description: null, createdAt: 0 }),
        row({ id: 'char_kept', description: KEEPER, createdAt: 9 }),
      ],
      embedDescriptions: embed,
      scene: null,
    })
    expect(embed).toHaveBeenCalledWith(['The keeper, ink on his hands.', KEEPER])
    // The one scored row ranks ahead of the older unscored ones.
    expect(decision).toEqual(flagOf('char_kept', 'distinct'))
  })

  it('makes no call when no namesake has a description', async () => {
    const embed = embedder({})
    const decision = await reconcileNewCharacter(candidate(), {
      entities: [row({ description: null })],
      embedDescriptions: embed,
      scene: null,
    })
    expect(embed).not.toHaveBeenCalled()
    expect(decision).toEqual(flagOf('char_1', 'no-signal'))
  })

  // Decision: a blank candidate description scores no namesake.
  it('scores nothing for a blank candidate description, flagging exact and partial no-signal', async () => {
    const embed = embedder({ [KEEPER]: 0.99 })
    const exact = await reconcileNewCharacter(candidate({ description: '  ' }), {
      entities: [row({ id: 'char_part', name: 'Eldrin Vane' }), row({ id: 'char_exact' })],
      embedDescriptions: embed,
      scene: null,
    })
    const partial = await reconcileNewCharacter(candidate({ description: '' }), {
      entities: [row({ id: 'char_part', name: 'Eldrin Vane' })],
      embedDescriptions: embed,
      scene: null,
    })
    expect(embed).not.toHaveBeenCalled()
    expect(exact).toEqual(flagOf('char_exact', 'no-signal'))
    expect(partial).toEqual(flagOf('char_part', 'no-signal'))
  })

  describe('an unusable embed reply leaves every namesake unscored', () => {
    const decide = (embedDescriptions: EmbedDescriptions) =>
      reconcileNewCharacter(candidate(), { entities: [row()], embedDescriptions, scene: null })

    it('when the call throws', async () => {
      expect(
        await decide(async () => {
          throw new Error('embedder offline')
        }),
      ).toEqual(flagOf('char_1', 'no-signal'))
    })

    it('when it returns fewer vectors than texts', async () => {
      expect(await decide(async () => ({ vectors: [new Float32Array([1, 0])], dim: 2 }))).toEqual(
        flagOf('char_1', 'no-signal'),
      )
    })

    it('when the vectors disagree on length', async () => {
      expect(
        await decide(async () => ({
          vectors: [new Float32Array([1, 0, 0]), new Float32Array([1, 0])],
          dim: 3,
        })),
      ).toEqual(flagOf('char_1', 'no-signal'))
    })

    it('when the vectors are empty', async () => {
      expect(
        await decide(async () => ({
          vectors: [new Float32Array([]), new Float32Array([])],
          dim: 0,
        })),
      ).toEqual(flagOf('char_1', 'no-signal'))
    })
  })

  describe('scene presence', () => {
    const decide = (scene: ReadonlySet<string> | null) =>
      reconcileNewCharacter(candidate(), {
        entities: [row({ status: 'staged' })],
        embedDescriptions: embedder({ [KEEPER]: 0.6 }),
        scene,
      })

    it('absorbs an ambiguous exact namesake in the scene', async () => {
      expect(await decide(new Set(['char_1']))).toEqual({
        kind: 'promote',
        entityId: 'char_1',
        similarity: 0.6,
      })
    })

    it('flags it when the scene holds others, or the handle fell back', async () => {
      expect(await decide(new Set(['char_other']))).toEqual(flagOf('char_1', 'ambiguous'))
      expect(await decide(null)).toEqual(flagOf('char_1', 'ambiguous'))
    })
  })
})

describe('cosine', () => {
  it('is 1 for identical unit vectors and 0 for orthogonal ones', () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1)
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0)
  })
})

describe('thresholds', () => {
  it('pins the canon starting ranges', () => {
    expect([TAU_LOW, TAU_HIGH]).toEqual([0.5, 0.75])
  })
})
