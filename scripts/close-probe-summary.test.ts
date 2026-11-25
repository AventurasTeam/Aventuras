import { describe, expect, it } from 'vitest'

import { summaryPersonLines, summaryPersonWords, type ChapterText } from './close-probe-summary'

const chapter = (run: number, summary: string): ChapterText => ({
  run,
  title: 'The Old Sea-dog at the Admiral Benbow',
  summary,
})

describe('summaryPersonWords', () => {
  it('finds none in a summary told in the third person', () => {
    expect(
      summaryPersonWords(
        chapter(1, 'Jim Hawkins hides in the apple barrel and overhears Silver plotting mutiny.'),
      ),
    ).toEqual([])
  })

  it('finds the first-person words a summary tells outside quoted speech', () => {
    expect(
      summaryPersonWords(
        chapter(1, 'I hide in the apple barrel and hear Silver plot against my friends.'),
      ),
    ).toEqual(['I', 'my'])
  })

  it('skips the words of quoted speech', () => {
    expect(
      summaryPersonWords(
        chapter(1, 'Silver tells Jim, "You and I will be rich," and Jim says nothing.'),
      ),
    ).toEqual([])
  })

  it('reads the summary, not the title', () => {
    expect(
      summaryPersonWords({ run: 1, title: 'I go ashore', summary: 'Jim goes ashore alone.' }),
    ).toEqual([])
  })
})

describe('summaryPersonLines', () => {
  it('counts the summaries told in the first or second person out of every one given, then names each run and its words', () => {
    expect(
      summaryPersonLines([
        chapter(1, 'Jim Hawkins finds the map in the captain’s chest.'),
        chapter(2, 'I find the map in the captain’s chest, and we sail for the island.'),
        chapter(4, 'You find the map, and Dr Livesey reads it.'),
      ]),
    ).toEqual([
      'summaries in the first or second person: 2 of 3 completed',
      '  run 2: I, we',
      '  run 4: You',
    ])
  })

  it('names no run when every summary is told in the third person', () => {
    expect(
      summaryPersonLines([
        chapter(1, 'Jim Hawkins finds the map in the captain’s chest.'),
        chapter(2, 'The squire buys the Hispaniola, and Silver signs on as cook.'),
      ]),
    ).toEqual(['summaries in the first or second person: 0 of 2 completed'])
  })

  it('counts none of none when no run completed', () => {
    expect(summaryPersonLines([])).toEqual([
      'summaries in the first or second person: 0 of 0 completed',
    ])
  })
})
