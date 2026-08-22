import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

// Radix's AlertDialogContent suppresses its own auto-focus and then focuses whatever registered
// as Cancel (`cancelRef.current?.focus()`). A footer of bare Buttons registers nothing, the
// optional chain no-ops, and focus stays outside the FocusScope — so the trap never engages and
// Tab walks the page behind the dialog. Nothing in the type system or the runtime says so.
const FOOTER_BLOCK = /<AlertDialogFooter\b[\s\S]*?<\/AlertDialogFooter>/g

// A dialog with no cancel affordance at all must focus its action by ref instead — see
// crash-recovery-modal.tsx, which is unacknowledgeable by design and does exactly that.
const FOCUSES_ACTION_BY_REF = ['components/story/crash-recovery-modal.tsx']

export function findFootersWithoutCancel(files: { path: string; src: string }[]): string[] {
  const offenders: string[] = []
  for (const { path, src } of files) {
    if (FOCUSES_ACTION_BY_REF.includes(path)) continue
    const footers = src.match(FOOTER_BLOCK) ?? []
    footers.forEach((footer, index) => {
      if (!footer.includes('AlertDialogCancel')) offenders.push(`${path}: footer #${index + 1}`)
    })
  }
  return offenders
}

// The other half of the same contract: a Cancel with no `onPress` routes its side
// effect through the root's `onOpenChange`. A root held permanently `open` with no
// handler has nowhere for that to go, so every dismissal silently does nothing.
const ROOT_OPEN_TAG = /<AlertDialog(\s[^>]*)?>/g

export function findAlwaysOpenDialogsWithoutHandler(
  files: { path: string; src: string }[],
): string[] {
  const offenders: string[] = []
  for (const { path, src } of files) {
    const roots = src.match(ROOT_OPEN_TAG) ?? []
    roots.forEach((root, index) => {
      const alwaysOpen = /\sopen\s*(?=[/>\s])/.test(root)
      if (alwaysOpen && !root.includes('onOpenChange')) {
        offenders.push(`${path}: root #${index + 1}`)
      }
    })
  }
  return offenders
}

const WITH_CANCEL = `
  <AlertDialogFooter>
    <AlertDialogCancel asChild><Button /></AlertDialogCancel>
    <Button onPress={go} />
  </AlertDialogFooter>
`
const WITHOUT_CANCEL = `
  <AlertDialogFooter>
    <Button variant="secondary" onPress={dismiss} />
    <Button onPress={go} />
  </AlertDialogFooter>
`

const ALWAYS_OPEN_HANDLED = `<AlertDialog open onOpenChange={(n) => { if (!n) back() }}>`
const ALWAYS_OPEN_UNHANDLED = `<AlertDialog open>`
const CONTROLLED = `<AlertDialog open={isOpen}>`

describe('an always-open AlertDialog wires onOpenChange', () => {
  it('tells a handled root from an unhandled one, and ignores a controlled root', () => {
    expect(
      findAlwaysOpenDialogsWithoutHandler([
        { path: 'components/a.tsx', src: ALWAYS_OPEN_HANDLED },
        { path: 'components/b.tsx', src: ALWAYS_OPEN_UNHANDLED },
        { path: 'components/c.tsx', src: CONTROLLED },
      ]),
    ).toEqual(['components/b.tsx: root #1'])
  })

  // Stories are excluded: one deliberately holds a dialog open as scenery for
  // another component's gate, and a fixture has no dismissal to answer.
  it('no shipped dialog holds itself open with no way to answer it', async () => {
    const paths = await fg(['app/**/*.tsx', 'components/**/*.tsx'], {
      ignore: ['**/node_modules/**', '**/*.stories.tsx'],
      cwd: process.cwd(),
    })
    const files = paths.map((path) => ({ path, src: readFileSync(path, 'utf8') }))
    expect(
      findAlwaysOpenDialogsWithoutHandler(files),
      'an AlertDialogCancel with no onPress needs the root to carry the side effect — give the root onOpenChange',
    ).toEqual([])
  })
})

describe('every AlertDialog footer offers a Cancel for Radix to focus', () => {
  it('tells a bare-Button footer from a Cancel-bearing one (detector is not vacuous)', () => {
    const found = findFootersWithoutCancel([
      { path: 'components/a.tsx', src: WITH_CANCEL },
      { path: 'components/b.tsx', src: WITHOUT_CANCEL },
      { path: 'components/c.tsx', src: WITH_CANCEL + WITHOUT_CANCEL },
    ])
    expect(found).toEqual(['components/b.tsx: footer #1', 'components/c.tsx: footer #2'])
  })

  it('honours the by-ref-focus exemption only for the files that take it', () => {
    expect(
      findFootersWithoutCancel([{ path: FOCUSES_ACTION_BY_REF[0], src: WITHOUT_CANCEL }]),
    ).toEqual([])
  })

  it('no shipped dialog leaves its footer without one', async () => {
    const paths = await fg(['app/**/*.tsx', 'components/**/*.tsx'], {
      ignore: ['**/node_modules/**'],
      cwd: process.cwd(),
    })
    const files = paths.map((path) => ({ path, src: readFileSync(path, 'utf8') }))
    expect(
      findFootersWithoutCancel(files),
      'wrap the dismissing Button in <AlertDialogCancel asChild> and drop its onPress — the primitive drives onOpenChange, and it fires before onPress on native but after it on web',
    ).toEqual([])
  })
})
