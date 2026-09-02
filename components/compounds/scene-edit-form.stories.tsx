// SceneEditForm stories — NoChange · ReorderIsNoChange · ClearsLocation · Saving.
// The overlay wrappers (SceneEditDialog, SceneEditSheet) own the save/failure states;
// these cover the form's own decisions about what counts as a change.
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent } from 'storybook/test'

import { SceneEditForm, type SceneOptions } from './scene-edit-form'

const OPTIONS: SceneOptions = {
  characters: [
    { id: 'char_a', name: 'Aria' },
    { id: 'char_b', name: 'Corin' },
  ],
  items: [{ id: 'item_a', name: 'Sword of Dawn' }],
  locations: [
    { id: 'loc_a', name: 'Ashfen Marshes' },
    { id: 'loc_b', name: 'Eldrin Keep' },
  ],
}

const meta: Meta<typeof SceneEditForm> = {
  title: 'Compounds/SceneEditForm',
  component: SceneEditForm,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View className="w-96 p-4">
        <Story />
      </View>
    ),
  ],
  args: {
    sceneEntities: ['char_a'],
    currentLocationId: 'loc_a',
    options: OPTIONS,
    onSave: fn(),
    onCancel: fn(),
  },
}

export default meta
type Story = StoryObj<typeof SceneEditForm>

// A no-op Save must not write: the delta would clear the global redo stack for nothing.
export const NoChangeTakesTheCancelRoute: Story = {
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(args.onCancel).toHaveBeenCalled()
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

// The scene is a set and the control emits in its own order, so a round trip that
// restores the same membership is not a change.
export const ReorderIsNotAChange: Story = {
  args: { sceneEntities: ['char_a', 'char_b'] },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('checkbox', { name: 'Aria' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Aria' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(args.onCancel).toHaveBeenCalled()
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

export const AddingAMemberSaves: Story = {
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('checkbox', { name: 'Corin' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(args.onSave).toHaveBeenCalledWith({
      sceneEntities: ['char_a', 'char_b'],
      currentLocationId: 'loc_a',
    })
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}

// The "no location" row is a sentinel value in the select; it must never reach the
// action layer as an entity id.
export const ClearingLocationSendsNull: Story = {
  play: async ({ args }) => {
    // Radio, not a dropdown: a dropdown opens a Sheet and this form is already in one.
    await userEvent.click(screen.getByText('— none —'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(args.onSave).toHaveBeenCalledWith({
      sceneEntities: ['char_a'],
      currentLocationId: null,
    })
  },
}

export const SavingLocksTheControls: Story = {
  args: { saving: true, saveError: 'Could not save the scene. Try again.' },
  play: async () => {
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the scene. Try again.')
    // Gated by inline pointer-events rather than the disabled prop alone: rn-primitives
    // wrappers do not stop a web click on their own (lessons-learned).
    expect(getComputedStyle(screen.getByRole('button', { name: 'Cancel' })).pointerEvents).toBe(
      'none',
    )
  },
}
