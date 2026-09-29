export type OverflowMenuEntry = {
  /** Stable identifier — the React key. */
  key: string
  label: string
  disabled?: boolean
  /** Web title tooltip, native inline hint, while disabled. */
  disabledReason?: string
  destructive?: boolean
  onPress: () => void
}

type DestructiveEntryAction = { onPress: () => void; disabledReason?: string }

/** A single destructive entry (e.g. `Delete …`), or none while the action isn't available yet. */
export function destructiveEntry(
  key: string,
  label: string,
  action: DestructiveEntryAction | undefined,
): OverflowMenuEntry[] {
  if (action == null) return []
  return [
    {
      key,
      label,
      destructive: true,
      disabled: action.disabledReason != null,
      disabledReason: action.disabledReason,
      onPress: action.onPress,
    },
  ]
}

export type RemoveEntry = { onDelete: () => void; disabledReason?: string }

/** The `Delete …` entry, or none while there's no row yet. */
export function deleteEntry(label: string, remove: RemoveEntry | undefined): OverflowMenuEntry[] {
  return destructiveEntry(
    'delete',
    label,
    remove == null
      ? undefined
      : { onPress: remove.onDelete, disabledReason: remove.disabledReason },
  )
}
