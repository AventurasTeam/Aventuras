import type { HERO_FORK as SeedHeroFork, heroForkTurns as seedHeroForkTurns } from './seed-dataset'

// The web bundle stays dataset-free (reseed.ts): desktop forks the seed through `pnpm db:seed`.
export const HERO_FORK: typeof SeedHeroFork = {
  id: 'br_hero_fork',
  parentId: 'br_hero_main',
  forkEntryId: 'entry_hero_0040',
  name: 'The road not taken',
  createdAt: 1_767_312_000_000,
}

export const heroForkTurns: typeof seedHeroForkTurns = () => {
  throw new Error('The web bundle carries no seed rows: run `pnpm db:seed` instead.')
}
