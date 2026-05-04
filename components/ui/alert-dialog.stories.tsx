import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'
import { Button } from './button'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof AlertDialog> = {
  title: 'Patterns/AlertDialog',
  component: AlertDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof AlertDialog>

export const Basic: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary">Open dialog</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Continue?</AlertDialogTitle>
          <AlertDialogDescription>
            This action will proceed. You can cancel out at any point.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="primary">Continue</Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

// Rollback shape — destructive CTA + bulleted impact list.
export const RollbackShape: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary">Trigger rollback</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete from entry 47?</AlertDialogTitle>
          <AlertDialogDescription>Permanent — rolls back to entry 46.</AlertDialogDescription>
        </AlertDialogHeader>
        <View className="gap-1">
          <Text size="sm">• 12 entries</Text>
          <Text size="sm">• 4 classifications</Text>
          <Text size="sm">• 23 world-state changes</Text>
        </View>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive">Delete entries</Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

// Calendar swap-warning shape — three structured sub-warning blocks
// between header and footer. Verifies rich content composes cleanly.
export const SwapWarningShape: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary">Switch calendar</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch calendar to Stardate?</AlertDialogTitle>
          <AlertDialogDescription>
            Three changes will apply on switch. Review each.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <View className="gap-3">
          <View className="bg-bg-region gap-1 rounded-md border border-warning p-3">
            <Text size="sm" className="font-medium">
              Origin tuple — Stardate&apos;s tier set differs.
            </Text>
            <Text size="xs" variant="muted">
              You&apos;ll need to re-pick the story-start moment.
            </Text>
          </View>
          <View className="bg-bg-region gap-1 rounded-md border border-warning p-3">
            <Text size="sm" className="font-medium">
              Era support mismatch.
            </Text>
            <Text size="xs" variant="muted">
              4 era flips on this branch reference an era Stardate doesn&apos;t define.
            </Text>
          </View>
          <View className="bg-bg-region gap-1 rounded-md border border-info p-3">
            <Text size="sm" className="font-medium">
              Display format change.
            </Text>
            <Text size="xs" variant="muted">
              Existing: Year 1247, day 88 → Stardate 47634.4
            </Text>
          </View>
        </View>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="primary">Switch calendar</Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-4"
          style={{ width: 320 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="secondary">Open</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete branch?</AlertDialogTitle>
                <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button variant="secondary">Cancel</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="destructive">Delete branch</Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </View>
      ))}
    </View>
  ),
}
