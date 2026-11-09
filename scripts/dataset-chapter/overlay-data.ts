import type { CharacterState, FactionState, Thread } from '@/lib/db'

/** A seed row the overlay writes, by its id and its seed name; `state` merges over the stored one. */
export type EntityOverlay =
  | {
      readonly kind: 'character'
      readonly id: string
      readonly name: string
      readonly state: Partial<CharacterState>
    }
  | {
      readonly kind: 'faction'
      readonly id: string
      readonly name: string
      readonly state: Partial<FactionState>
    }

/** A user's edit of one field, made after the chapter: logged, so precedence reads it. */
export type OverlayUserEdit = {
  readonly id: string
  readonly name: string
  readonly description: string
}

export type PlantedThread = {
  /** The seed's active thread it repeats. */
  readonly duplicates: { readonly id: string; readonly title: string }
  readonly row: Omit<Thread, 'branchId'>
}

export type DatasetOverlay = {
  readonly entities: readonly EntityOverlay[]
  readonly userEdit: OverlayUserEdit
  readonly plantedThread: PlantedThread
}

const BUCCANEERS = 'fact_893030a8-baf7-4b38-a97d-0737a6551fd9'
const SILVER = 'char_7f241601-a656-4302-9163-d3333b59ffb6'

// Each value has its evidence in the chapter (treasure-island.txt). Captain Smollett, Arrow, Tom
// Redruth, Jim's mother, the maid and Supervisor Dance stay as the seed has them.
export const DATASET_OVERLAY: DatasetOverlay = {
  entities: [
    {
      // Over the cap, with a synonym pair and a fear the Spy-glass ends.
      kind: 'character',
      id: 'char_25b8a728-1ab9-4ee6-994d-0a44dd2ea897',
      name: 'Jim Hawkins',
      state: {
        traits: [
          'young',
          "son of the Admiral Benbow's keeper",
          'curious',
          'brave',
          'courageous',
          'watchful',
          'loyal to his mother',
          'full of sea-dreams',
          'afraid of the one-legged seafaring man',
          "the squire's cabin-boy",
        ],
      },
    },
    {
      // At the cap; the chapter shows him a magistrate, calm under a drawn knife.
      kind: 'character',
      id: 'char_82275468-0258-40b1-865e-fdac2268b847',
      name: 'Dr. Livesey',
      state: {
        traits: [
          'neat',
          'bright',
          'pleasant',
          'courteous',
          'well-mannered',
          'learned',
          'smokes a pipe',
          "ship's doctor",
        ],
      },
    },
    {
      // At the cap; the chapter shows him intelligent, smiling and too clever for Jim.
      kind: 'character',
      id: SILVER,
      name: 'Long John Silver',
      state: {
        traits: [
          'old sailor',
          'man of substance',
          "has a banker's account",
          'lost a leg',
          'one-legged',
          'keeps a public-house in Bristol',
          'knows every seaman in Bristol',
          "ship's cook of the Hispaniola",
        ],
      },
    },
    {
      // At the cap; the chapter contradicts the secret and gives him the sea over the treasure.
      kind: 'character',
      id: 'char_ca888ce4-6fed-48d5-9489-388ae1b09f77',
      name: 'Trelawney',
      state: {
        drives: [
          "find Flint's treasure",
          'buy and fit out a ship at Bristol',
          'hire the choicest crew in England',
          'sail as admiral of the voyage',
          'keep the treasure voyage secret',
          'take Redruth, Joyce and Hunter along',
        ],
      },
    },
    {
      kind: 'character',
      id: 'char_3f7109f9-d27b-4053-8d21-2633514b6425',
      name: 'Black Dog',
      state: { faction_id: BUCCANEERS },
    },
    {
      kind: 'character',
      id: 'char_c26c4512-2a0f-492a-8935-364963dc9897',
      name: 'Pew',
      state: { faction_id: BUCCANEERS },
    },
    {
      kind: 'character',
      id: 'char_75cbbdf4-8b97-474a-93a7-15322c945215',
      name: 'Dirk',
      state: { faction_id: BUCCANEERS },
    },
    {
      kind: 'character',
      id: 'char_9f21f12c-725d-4c55-8326-3af3fb8acb75',
      name: 'Johnny',
      state: { faction_id: BUCCANEERS },
    },
    {
      // At the cap; the raid resolves the black spot and Black Dog turns up in Bristol.
      kind: 'faction',
      id: BUCCANEERS,
      name: 'the buccaneers',
      state: {
        standing:
          "Feared along the coast, with a lugger waiting in Kitt's Hole for Flint's papers.",
        agenda: [
          "take Flint's papers from Billy Bones",
          'tip Billy Bones the black spot',
          'search the Admiral Benbow for the sea-chest',
          "keep the lugger hidden in Kitt's Hole",
        ],
      },
    },
  ],
  userEdit: {
    id: SILVER,
    name: 'Long John Silver',
    description:
      'The one-legged cook of the Hispaniola, who keeps the Spy-glass tavern on the Bristol docks.',
  },
  plantedThread: {
    duplicates: {
      id: 'thr_1b3d556f-e9aa-4701-a6f6-aa3076965215',
      title: "The search for Flint's treasure",
    },
    row: {
      id: 'thr_6f1c0b7e-3a52-4d88-9e41-2b7c5d0a9f13',
      title: 'Where Flint buried his treasure',
      description:
        'The doctor holds a clue to where Captain Flint buried his treasure, and the squire means to fit out a ship and have it.',
      category: 'quest',
      icon: 'map',
      status: 'pending',
      injectionMode: 'auto',
      triggeredAtEntryId: 'entry_571c194c-f31b-45fc-ab40-cf4a4d02b7cc',
      resolvedAtEntryId: null,
      embeddingStale: 1,
      createdAt: 1_793_907_370_600,
      updatedAt: 1_793_907_370_600,
    },
  },
}
