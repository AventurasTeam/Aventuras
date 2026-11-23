import { eq, max } from 'drizzle-orm'

import { idleStatus } from '@/lib/classifier'
import { branches, deltas, HERO_FORK, heroForkTurns, storyEntries } from '@/lib/db'

import { forkBranchCore } from './fork-branch'
import type { DbCtx } from '../types'

/** C7: rebuilds the seed's br_hero_fork as a real fork of br_hero_main, then its own turns. */
export async function seedHeroFork(ctx: DbCtx): Promise<void> {
  const forked = await forkBranchCore(
    {
      parentBranchId: HERO_FORK.parentId,
      forkEntryId: HERO_FORK.forkEntryId,
      name: HERO_FORK.name,
      makeCurrent: false,
      newBranchId: HERO_FORK.id,
      createdAt: HERO_FORK.createdAt,
    },
    ctx,
  )
  if (forked.status !== 'ok')
    throw new Error(`seed: forking ${HERO_FORK.id} refused (${forked.code}): ${forked.reason}`)

  const [copied] = await ctx.db
    .select({ top: max(deltas.logPosition) })
    .from(deltas)
    .where(eq(deltas.branchId, HERO_FORK.id))
  const turns = heroForkTurns(copied?.top ?? 0)
  // docs/testing.md → Fixture + seed contract: the turns are the fork's tail, so it parks on the
  // last of them.
  const processedThrough = Math.max(...turns.entries.map((entry) => entry.position))
  await ctx.runInTransaction([
    ctx.db.insert(storyEntries).values(turns.entries).toSQL(),
    ctx.db.insert(deltas).values(turns.deltas).toSQL(),
    ctx.db
      .update(branches)
      .set({ classifierStatus: { ...idleStatus(), processedThrough } })
      .where(eq(branches.id, HERO_FORK.id))
      .toSQL(),
  ])
}
