import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import type { SceneOptions, SceneSaveResult } from '@/components/compounds/scene-edit-form'
import { expectTopmost, pressSheetScrim } from '@/components/ui/sheet-scrim-probe'
import { Text } from '@/components/ui/text'

import { SceneEditSheet } from './scene-edit-sheet'

const OPTIONS: SceneOptions = {
  characters: [
    { id: 'char_a', name: 'Aria' },
    { id: 'char_b', name: 'Corin' },
  ],
  items: [],
  locations: [{ id: 'loc_a', name: 'Ashfen Marshes' }],
}

const LANDMARK = 'Reader behind the editor'

// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 3000 }

const meta: Meta<typeof SceneEditSheet> = {
  title: 'Compounds/Reader/SceneEditSheet',
  component: SceneEditSheet,
  parameters: { layout: 'fullscreen' },
  args: {
    sceneEntities: ['char_a'],
    currentLocationId: 'loc_a',
    options: OPTIONS,
    onSave: fn(async (): Promise<SceneSaveResult> => ({ ok: true })),
    onClose: fn(),
  },
  // The tall detent is 95% of the host, so a tall canvas keeps the landmark above the sheet.
  render: (args) => (
    <View className="gap-4 p-4" style={{ minHeight: 1200 }}>
      <Text>{LANDMARK}</Text>
      <SceneEditSheet {...args} />
    </View>
  ),
}

export default meta
type Story = StoryObj<typeof SceneEditSheet>

// gorhom presents a tick after mount, so every play waits for a row.
const corin = () => screen.getByRole('checkbox', { name: 'Corin' })

// Focusing a row scrolls the tall canvas, which carries the landmark out of the viewport.
async function toggleCorin() {
  await userEvent.click(corin())
  window.scrollTo({ top: 0 })
}
async function openSheet() {
  await waitFor(() => expect(corin()).toBeVisible(), WAIT)
}

/** The sections keep the form's gap inside the sheet, as they do in the desktop Dialog. */
export const SectionsKeepTheirGap: Story = {
  play: async () => {
    await openSheet()
    const apply = screen.getByText(/Saving re-applies scene presence/)
    const prose = screen.getByText(/This doesn't change the entry's text/)
    const gap = prose.getBoundingClientRect().top - apply.getBoundingClientRect().bottom
    expect(gap).toBeGreaterThanOrEqual(11)
    expect(gap).toBeLessThanOrEqual(13)
  },
}

/** Untouched, a tap outside the editor closes it, as drag-down does. */
export const BackdropClosesUntouched: Story = {
  play: async ({ args }) => {
    await openSheet()
    await pressSheetScrim(screen.getByText(LANDMARK))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
  },
}

const guard = () => screen.getByRole('alertdialog', { name: 'Unsaved changes' })
const guardButton = (name: string) => within(guard()).getByRole('button', { name })

async function raiseGuard() {
  await pressSheetScrim(screen.getByText(LANDMARK))
  await waitFor(() => expect(guard()).toBeVisible(), WAIT)
}

/** An edit holds the sheet: tap-outside raises the unsaved-changes guard over it instead. */
export const BackdropRaisesGuardWhileEdited: Story = {
  play: async ({ args }) => {
    await openSheet()
    await toggleCorin()
    await raiseGuard()
    expectTopmost(guardButton('Discard'))
    expect(args.onClose).not.toHaveBeenCalled()

    // Cancel keeps editing: the guard goes, the sheet and its draft stay.
    await userEvent.click(guardButton('Cancel'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(), WAIT)
    expect(corin()).toBeChecked()
    expect(args.onClose).not.toHaveBeenCalled()

    window.scrollTo({ top: 0 })
    await raiseGuard()
    await userEvent.click(guardButton('Discard'))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/** The guard's Save writes the draft and closes, as the sheet's own Save does. */
export const GuardSaveWritesTheDraft: Story = {
  play: async ({ args }) => {
    await openSheet()
    await toggleCorin()
    await raiseGuard()
    await userEvent.click(guardButton('Save'))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onSave).toHaveBeenCalledWith({
      sceneEntities: ['char_a', 'char_b'],
      currentLocationId: 'loc_a',
    })
  },
}

/** Dirty means different from the opening scene: undoing the edit frees the sheet again. */
export const BackdropClosesAfterRevert: Story = {
  play: async ({ args }) => {
    await openSheet()
    await toggleCorin()
    await toggleCorin()
    await pressSheetScrim(screen.getByText(LANDMARK))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
  },
}
