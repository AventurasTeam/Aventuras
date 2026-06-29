export class MalformedPlaceholderError extends Error {
  constructor(readonly placeholder: string) {
    super(`Unrecognized or malformed placeholder: ${placeholder}`)
    this.name = 'MalformedPlaceholderError'
  }
}
