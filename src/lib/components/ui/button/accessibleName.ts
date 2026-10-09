type Text = string | null | undefined

interface AccessibleNameInput {
  ariaLabel: Text
  size: Text
  isResponsive: boolean
  label: Text
  title: Text
}

/**
 * The name for a button that may show no text: icon-sized, or responsive (its text is hidden
 * below `sm`). `label` comes before `title` so the name contains the visible text.
 */
export function accessibleName({
  ariaLabel,
  size,
  isResponsive,
  label,
  title,
}: AccessibleNameInput): Text {
  return ariaLabel ?? (size === 'icon' || isResponsive ? (label ?? title) : undefined)
}
