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
    let inTag = false
    let quote: '"' | "'" | null = null
    let tagStart = -1

    for (let i = 0; i < full.length; i++) {
      const ch = full[i]
      if (quote) {
        if (ch === quote) quote = null
        continue
      }
      if (inTag) {
        if (ch === '"' || ch === "'") {
          quote = ch
          continue
        }
        if (ch === '>') {
          inTag = false
          tagStart = -1
        }
        continue
      }
      if (ch === '<') {
        const next = full[i + 1]
        // Only a genuine tag-start if what follows looks like markup; a bare '<'
        // in prose ("x < y") isn't withheld. undefined => end of buffer, stay safe.
        if (next === undefined || /[a-zA-Z/!]/.test(next)) {
          inTag = true
          tagStart = i
        }
      }
    }

    return inTag && tagStart >= 0 ? full.slice(0, tagStart) : full
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
