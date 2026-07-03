export type HtmlStreamBuffer = {
  // Feeds one more raw chunk; returns everything safe to render so far.
  push(chunk: string): string
  // Returns whatever is still pending (used when the stream ends abruptly).
  flush(): string
}

// Buffers until every '<' seen so far has a matching '>' — a half-open tag never
// reaches the renderer (docs/tech-stack.md -> htmlStreaming port).
export function createHtmlStreamBuffer(): HtmlStreamBuffer {
  let full = ''

  function recompute(): string {
    const lastOpen = full.lastIndexOf('<')
    const lastClose = full.lastIndexOf('>')
    return lastOpen > lastClose ? full.slice(0, lastOpen) : full
  }

  return {
    push(chunk: string): string {
      full += chunk
      return recompute()
    },
    flush(): string {
      return full
    },
  }
}
