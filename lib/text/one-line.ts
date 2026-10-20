/** Every whitespace run as one space, line breaks included: for a value inside a one-line list item. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
