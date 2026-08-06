import { describe, expect, it } from 'vitest'

import { countTokens, ENTITY_FRAMING, RANKER_DEFAULTS, type RetrievalType } from '@/lib/retrieval'

import { createEngine } from '../engine'
import { MACRO_IDS } from '../ids'
import type { Pack } from '../types'
import { MEMORY_BLOCKS } from './memory-blocks'

function renderMacro(context: Record<string, unknown>): string {
  const pack: Pack = {
    templates: {
      t: { group: 'generationContext', source: `{% include '${MACRO_IDS.memoryBlocks}' %}` },
    },
    macros: { [MACRO_IDS.memoryBlocks]: { group: 'staticContent', source: MEMORY_BLOCKS } },
  }
  return createEngine(pack).renderFileSync('t', context) as string
}

// Every bucket the macro reads, all empty. Spread-and-override so each test
// populates exactly one and the rest stay provably absent.
const EMPTY = {
  structuralPinnedEntities: [],
  structuralPinnedLore: [],
  structuralPinnedThreads: [],
  structuralActiveThreads: [],
  retrievedEntities: [],
  retrievedLore: [],
  retrievedHappenings: [],
  retrievedThreads: [],
  retrievedChapters: [],
  piggybackFires: true,
}

const ranked = (id: string, displayName: string, renderedText: string) => ({
  id,
  displayName,
  renderedText,
})

const floorEntity = {
  id: 'char_9',
  kind: 'character',
  status: 'retired',
  name: 'Old Sesk',
  description: 'A ferryman long dead.',
}
const floorLore = { id: 'lore_9', title: 'The Concord', body: 'Signed at the river.' }
const floorThread = { id: 'thr_9', status: 'pending', title: 'The debt', description: 'Unpaid.' }

describe('memory-blocks macro — empty-guard contract', () => {
  it('renders nothing at all when every bucket is empty', () => {
    expect(renderMacro(EMPTY).trim()).toBe('')
    // Positive control: the same helper does produce a block when one bucket
    // is populated, so the assertion above is not passing on a dead render.
    expect(
      renderMacro({ ...EMPTY, retrievedLore: [ranked('lore_1', 'Veilstone', 'x')] }),
    ).toContain('# Relevant lore')
  })

  const blocks: [header: string, key: string, row: unknown][] = [
    ['# Elsewhere in the world', 'structuralPinnedEntities', floorEntity],
    ['# Elsewhere in the world', 'retrievedEntities', ranked('char_1', 'Mira', 'Mira: a courier.')],
    ['# Relevant lore', 'structuralPinnedLore', floorLore],
    ['# Relevant lore', 'retrievedLore', ranked('lore_1', 'Veilstone', 'Veilstone\nA shard.')],
    [
      '# What has happened',
      'retrievedHappenings',
      ranked('hap_1', 'The bridge fell', 'The bridge fell\nAt dawn.'),
    ],
    ['# Active threads', 'structuralActiveThreads', { ...floorThread, status: 'active' }],
    ['# Background threads', 'structuralPinnedThreads', floorThread],
    ['# Background threads', 'retrievedThreads', ranked('thr_1', 'The debt', 'The debt\nUnpaid.')],
    [
      '# Earlier chapters',
      'retrievedChapters',
      ranked('chap_1', 'The Long Road', 'She left the capital.\nDeparture.'),
    ],
  ]

  it.each(blocks)('emits %s only when %s is populated', (header, key, row) => {
    expect(renderMacro({ ...EMPTY, [key]: [row] })).toContain(header)
    expect(renderMacro(EMPTY)).not.toContain(header)
  })
})

describe('memory-blocks macro — row content', () => {
  it('renders the ranked entity text the ranker measured, with its sub-pool framing', () => {
    const out = renderMacro({
      ...EMPTY,
      retrievedEntities: [ranked('char_2', 'Mira', 'Mira (available to introduce): A courier.')],
    })
    expect(out).toContain('[char_2] Mira (available to introduce): A courier.')
  })

  it('brackets entity ids only when piggybackFires, and never on the other types', () => {
    const context = {
      ...EMPTY,
      structuralPinnedEntities: [floorEntity],
      retrievedEntities: [ranked('char_2', 'Mira', 'Mira: A courier.')],
      retrievedLore: [ranked('lore_1', 'Veilstone', 'Veilstone\nA shard.')],
      retrievedHappenings: [ranked('hap_1', 'Fall', 'Fall\nAt dawn.')],
      retrievedThreads: [ranked('thr_1', 'Debt', 'Debt\nUnpaid.')],
      retrievedChapters: [ranked('chap_1', 'Road', 'She left.\nDeparture.')],
    }
    const firing = renderMacro(context)
    expect(firing).toContain('[char_2] Mira')
    expect(firing).toContain('[char_9] Old Sesk')
    for (const id of ['lore_1', 'hap_1', 'thr_1', 'chap_1']) expect(firing).not.toContain(id)

    const quiet = renderMacro({ ...context, piggybackFires: false })
    expect(quiet).not.toContain('[char_2]')
    expect(quiet).not.toContain('[char_9]')
    // Positive control: the rows themselves still render, only the ids drop.
    expect(quiet).toContain('Mira: A courier.')
    expect(quiet).toContain('Old Sesk')
  })

  it('carries no emission instructions — those belong to the including template', () => {
    const out = renderMacro({
      ...EMPTY,
      structuralPinnedEntities: [floorEntity],
      retrievedEntities: [ranked('char_2', 'Mira', 'Mira: A courier.')],
    })
    expect(out).not.toContain('<scene_entities>')
    expect(out).not.toContain('<current_location>')
    // Positive control: the rows the instructions would have referred to render.
    expect(out).toContain('[char_2] Mira: A courier.')
  })

  it('renders happening awareness sources verbatim, newlines and all', () => {
    const out = renderMacro({
      ...EMPTY,
      retrievedHappenings: [
        ranked(
          'hap_1',
          'The bridge fell',
          'The bridge fell\nAt dawn.\nSaw it happen\nHeard a rumor',
        ),
      ],
    })
    expect(out).toContain('The bridge fell\nAt dawn.\nSaw it happen\nHeard a rumor')
  })

  it('puts pinned and ranked lore under one header, pinned first', () => {
    const out = renderMacro({
      ...EMPTY,
      structuralPinnedLore: [floorLore],
      retrievedLore: [ranked('lore_1', 'Veilstone', 'Veilstone\nA shard.')],
    })
    expect(out.split('# Relevant lore')).toHaveLength(2)
    expect(out.indexOf('The Concord')).toBeLessThan(out.indexOf('Veilstone'))
    expect(out).toContain('Signed at the river.')
  })

  // Whole render, not substrings: the two row families differ in shape but not
  // in framing, so they share one header the way lore's and threads' do — and a
  // second header would still leave every substring assertion green.
  it('puts pinned and ranked entities under one header, pinned first', () => {
    const out = renderMacro({
      ...EMPTY,
      structuralPinnedEntities: [floorEntity],
      retrievedEntities: [ranked('char_2', 'Mira', 'Mira (currently elsewhere): A courier.')],
    })
    expect(out).toBe(
      '# Elsewhere in the world\n\n[char_9] Old Sesk: A ferryman long dead.\n\n[char_2] Mira (currently elsewhere): A courier.\n\n',
    )
  })

  // A pinned row bypasses the ranker, so nothing pre-renders its sub-pool
  // framing the way run.ts does for a candidate. Without it a pinned staged
  // character reads as an existing off-scene figure rather than one the model
  // may introduce.
  it.each([
    ['active', ENTITY_FRAMING.active],
    ['staged', ENTITY_FRAMING.staged],
  ])('frames a pinned %s entity the same way the ranker frames a candidate', (status, framing) => {
    const out = renderMacro({
      ...EMPTY,
      structuralPinnedEntities: [{ ...floorEntity, status }],
    })
    expect(out).toContain(`[char_9] Old Sesk (${framing}): A ferryman long dead.`)
  })

  it('leaves a pinned retired entity unframed', () => {
    const out = renderMacro({ ...EMPTY, structuralPinnedEntities: [floorEntity] })
    expect(out).toContain('[char_9] Old Sesk: A ferryman long dead.')
    expect(out).not.toContain('(')
  })

  it('puts pinned and ranked non-active threads under one header, pinned first', () => {
    const out = renderMacro({
      ...EMPTY,
      structuralPinnedThreads: [floorThread],
      retrievedThreads: [ranked('thr_1', 'The ledger', 'The ledger (failed)\nStill missing.')],
    })
    expect(out.split('# Background threads')).toHaveLength(2)
    expect(out.indexOf('The debt')).toBeLessThan(out.indexOf('The ledger'))
    expect(out).toContain('Still missing.')
  })

  // data-model.md → threads: "failed is distinct because lumping them together
  // loses useful information". A header that says only "not active" lumps them,
  // and a paid debt rendered like an open one has the model write the character
  // still dodging it.
  it.each(['pending', 'resolved', 'failed'])(
    'marks a pinned %s thread with its status',
    (status) => {
      const out = renderMacro({ ...EMPTY, structuralPinnedThreads: [{ ...floorThread, status }] })
      expect(out).toContain(`The debt (${status})`)
    },
  )

  it('renders a chapter from its renderedText alone — the title rides inside it', () => {
    const out = renderMacro({
      ...EMPTY,
      retrievedChapters: [
        ranked('chap_1', 'The Long Road', 'The Long Road\nShe left the capital.\nDeparture.'),
      ],
    })
    expect(out).toContain('The Long Road\nShe left the capital.\nDeparture.')
    // The measured cost is countTokens(renderedText); a title on a `##` line
    // outside it is length the type budget never charged for.
    expect(out).not.toContain('##')
  })

  // per-turn.ts guards the identical case for structuralLocation. Every
  // structural row is a raw column projection, so every nullable column needs
  // the same guard or its separator ships without its value. Asserted as whole
  // renders, not substrings: an unguarded newline separator is invisible to
  // toContain, since the block's own trailer supplies an identical one.
  const activeThread = { ...floorThread, status: 'active' }
  const nullColumn: [key: string, populated: object, nulled: object, whole: string][] = [
    [
      'structuralPinnedEntities',
      floorEntity,
      { ...floorEntity, description: null },
      '# Elsewhere in the world\n\n[char_9] Old Sesk\n\n',
    ],
    [
      'structuralPinnedLore',
      floorLore,
      { ...floorLore, body: null },
      '# Relevant lore\n\nThe Concord\n\n',
    ],
    [
      'structuralPinnedThreads',
      floorThread,
      { ...floorThread, description: null },
      '# Background threads\n\nThe debt (pending)\n\n',
    ],
    [
      'structuralActiveThreads',
      activeThread,
      { ...activeThread, description: null },
      '# Active threads\n\nThe debt\n\n',
    ],
  ]

  it.each(nullColumn)(
    'drops the separator when a %s row has a null column',
    (key, populated, nulled, whole) => {
      expect(renderMacro({ ...EMPTY, [key]: [nulled] })).toBe(whole)
      // Positive control: the same row with the column filled does emit the
      // separator, so the assertion above is not passing on a dead render.
      expect(renderMacro({ ...EMPTY, [key]: [populated] })).not.toBe(whole)
    },
  )

  it('matches the recorded snapshot with every block populated', () => {
    expect(
      renderMacro({
        ...EMPTY,
        structuralPinnedEntities: [floorEntity],
        structuralPinnedLore: [floorLore],
        structuralPinnedThreads: [floorThread],
        structuralActiveThreads: [
          { id: 'thr_8', status: 'active', title: 'The siege', description: 'Three weeks in.' },
        ],
        retrievedEntities: [ranked('char_2', 'Mira', 'Mira (currently elsewhere): A courier.')],
        retrievedLore: [ranked('lore_1', 'Veilstone', 'Veilstone\nA shard of the old moon.')],
        retrievedHappenings: [
          ranked('hap_1', 'The bridge fell', 'The bridge fell\nAt dawn.\nSaw it happen'),
        ],
        retrievedThreads: [ranked('thr_1', 'The ledger', 'The ledger (failed)\nStill missing.')],
        retrievedChapters: [
          ranked('chap_1', 'The Long Road', 'The Long Road\nShe left the capital.\nDeparture.'),
        ],
      }),
    ).toMatchSnapshot()
  })

  it('keeps active threads out of the non-active block', () => {
    const out = renderMacro({
      ...EMPTY,
      structuralActiveThreads: [{ ...floorThread, status: 'active', title: 'The siege' }],
    })
    expect(out).toContain('# Active threads')
    expect(out).toContain('The siege')
    expect(out).not.toContain('# Background threads')
  })
})

// retrieval.md → Token estimation: the ranker charges
// countTokens(renderedText) + typeOverhead[type] for every row it seats, so
// typeOverhead has to be this macro's own wrapping cost. Measured by rendering
// exactly one row of the block with no content of its own and counting what is
// left; a macro edit that changes the wrapper fails here until the constant
// follows. What the one-row basis buys, and where it stops being conservative,
// is recorded there too.
const CONSTANT_PATH = 'lib/retrieval/constants.ts → RANKER_DEFAULTS.typeOverhead'

const OVERHEAD_BUCKET: Record<RetrievalType, string> = {
  entities: 'retrievedEntities',
  lore: 'retrievedLore',
  happenings: 'retrievedHappenings',
  threads: 'retrievedThreads',
  chapters: 'retrievedChapters',
}

// piggybackFires true is the costlier of the two shapes — it brackets an id
// beside every entity row — and the ranker has no per-turn flag to branch on.
// `c1` is the substituted-placeholder shape an id actually has at prompt time.
// Entity placeholders are a single letter plus a counter (lib/ids/prefixes.ts →
// PLACEHOLDER_PREFIX_BY_KIND) and every one up to three digits costs the same 4
// tokens, so only a branch seating a four-digit id under-charges, by one.
const PROBE_ROW = { id: 'c1', displayName: '', renderedText: '' }

describe('per-type overhead constants', () => {
  const types = Object.keys(OVERHEAD_BUCKET) as RetrievalType[]

  it.each(types)('typeOverhead.%s is what the macro wrapper actually costs', (type) => {
    const measured = countTokens(renderMacro({ ...EMPTY, [OVERHEAD_BUCKET[type]]: [PROBE_ROW] }))
    // Guards the equality below against a macro that renders nothing: a
    // zero-cost wrapper would let a zeroed constant pass silently.
    expect(measured).toBeGreaterThan(0)
    // Whoever trips this is editing a Liquid template and has no reason to know
    // the constant exists, so the message has to name it and the new value.
    expect(
      RANKER_DEFAULTS.typeOverhead[type],
      `The ${type} block's wrapper now costs ${measured} tokens. Set ${CONSTANT_PATH}.${type} to ${measured}.`,
    ).toBe(measured)
  })

  // The overhead above is measured with displayName: '', so a block that starts
  // rendering the title costs nothing on the probe row and everything in
  // production — ~20 seated rows carrying an uncharged title overrun their
  // partition, and the snapshot diff reads as an intentional "show lore titles".
  // renderedText is the only field the ranker charges for; nothing else may vary
  // the output length.
  it.each(types)('%s rows render nothing whose length the ranker did not charge', (type) => {
    const withRow = (displayName: string) =>
      renderMacro({
        ...EMPTY,
        [OVERHEAD_BUCKET[type]]: [{ id: 'c1', displayName, renderedText: 'The body.' }],
      })

    expect(withRow('x'.repeat(200))).toBe(withRow('x'))
  })
})
