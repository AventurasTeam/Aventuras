import { LocalLinter, BinaryModule, type Lint, type Suggestion, type LintConfig } from 'harper.js'
import wasmUrl from 'harper.js/dist/harper_wasm_bg.wasm?url'
import { database } from '$lib/services/database'
import { createLogger } from '$lib/log'

const log = createLogger('Grammar')

const CUSTOM_DICTIONARY_KEY = 'harper_custom_dictionary_words'

export type AddWordResult = 'added' | 'exists' | 'invalid'
export type RemoveWordResult = 'removed' | 'not_found' | 'invalid'

export interface GrammarIssue {
  message: string
  problemText: string
  start: number
  end: number
  suggestions: string[]
  kind: string
}

class GrammarService {
  private linter: LocalLinter | null = null
  private setupPromise: Promise<void> | null = null
  private enabled = true
  private customWordsLoaded = false
  private customWords = new Map<string, string>()
  private entityWords = new Set<string>()
  private dictionaryQueue: Promise<void> = Promise.resolve()

  private queueDictionaryOperation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.dictionaryQueue.then(operation, operation)
    this.dictionaryQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private normalizeWord(word: string): { display: string; canonical: string } | null {
    const trimmed = word.trim()
    if (!trimmed) return null

    const normalized = trimmed.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
    if (!normalized || /\s/u.test(normalized)) return null

    return {
      display: normalized,
      canonical: normalized.toLocaleLowerCase(),
    }
  }

  private async ensureCustomWordsLoaded(): Promise<void> {
    if (this.customWordsLoaded) return

    try {
      const customWordsJson = await database.getSetting(CUSTOM_DICTIONARY_KEY)
      this.customWords.clear()
      if (customWordsJson) {
        const parsed = JSON.parse(customWordsJson) as unknown
        if (Array.isArray(parsed)) {
          for (const value of parsed) {
            if (typeof value !== 'string') continue
            const normalized = this.normalizeWord(value)
            if (!normalized || this.customWords.has(normalized.canonical)) continue
            this.customWords.set(normalized.canonical, normalized.display)
          }
        }
      }
    } catch (error) {
      log('Failed to load custom dictionary words:', error)
      this.customWords.clear()
    } finally {
      this.customWordsLoaded = true
    }
  }

  private async persistCustomWords(): Promise<void> {
    const words = [...this.customWords.values()]
    if (words.length === 0) {
      await database.deleteSetting(CUSTOM_DICTIONARY_KEY)
      return
    }
    await database.setSetting(CUSTOM_DICTIONARY_KEY, JSON.stringify(words))
  }

  async setup(): Promise<void> {
    if (this.linter) return
    if (this.setupPromise) return this.setupPromise

    this.setupPromise = (async () => {
      try {
        log('Initializing Harper linter...')

        // Load the WASM binary using Vite's URL import
        const binary = BinaryModule.create(wasmUrl)
        await binary.setup()

        this.linter = new LocalLinter({ binary })
        await this.linter.setup()

        // Configure linter - disable some rules that might be too strict for creative writing
        const config = await this.linter.getLintConfig()
        // Disable rules that might interfere with creative writing
        const updatedConfig: LintConfig = {
          ...config,
          // Keep most rules enabled, but disable some that might be annoying
          SentenceCapitalization: false, // Creative writing might have stylistic lowercase
          LongSentences: false, // Creative writing often has long sentences
        }
        await this.linter.setLintConfig(updatedConfig)

        await this.ensureCustomWordsLoaded()
        const customWords = [...this.customWords.values()]
        if (customWords.length > 0) {
          await this.linter.importWords(customWords)
        }

        log('Harper linter initialized successfully')
      } catch (error) {
        console.error('[Grammar] Failed to initialize Harper:', error)
        this.linter = null
      }
    })()

    return this.setupPromise
  }

  async lint(text: string): Promise<GrammarIssue[]> {
    if (!this.enabled || !text.trim()) return []

    await this.setup()
    if (!this.linter) return []

    try {
      const lints = await this.linter.lint(text, { language: 'plaintext' })
      log('Linted text, found', lints.length, 'issues')

      return lints.map((lint: Lint) => {
        const span = lint.span()
        const suggestions = lint.suggestions()

        return {
          message: lint.message(),
          problemText: lint.get_problem_text(),
          start: span.start,
          end: span.end,
          suggestions: suggestions.map((s: Suggestion) => s.get_replacement_text()),
          kind: lint.lint_kind_pretty(),
        }
      })
    } catch (error) {
      log('Linting failed:', error)
      return []
    }
  }

  async applySuggestion(
    text: string,
    issue: GrammarIssue,
    suggestionIndex: number,
  ): Promise<string> {
    if (!this.linter) return text

    try {
      // Reconstruct by replacing the span with the suggestion text
      const suggestion = issue.suggestions[suggestionIndex]
      if (suggestion === undefined) return text

      const before = text.slice(0, issue.start)
      const after = text.slice(issue.end)
      return before + suggestion + after
    } catch (error) {
      log('Failed to apply suggestion:', error)
      return text
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  async addWord(word: string): Promise<AddWordResult> {
    return this.queueDictionaryOperation(async () => {
      const normalized = this.normalizeWord(word)
      if (!normalized) return 'invalid'

      await this.ensureCustomWordsLoaded()

      if (this.customWords.has(normalized.canonical)) {
        return 'exists'
      }

      this.customWords.set(normalized.canonical, normalized.display)
      await this.persistCustomWords()
      await this.setup()

      if (this.linter) {
        try {
          await this.linter.importWords([normalized.display])
          log('Added word to dictionary:', normalized.display)
        } catch (error) {
          log('Failed to import added word into linter:', error)
        }
      }

      return 'added'
    })
  }

  async getCustomWords(): Promise<string[]> {
    return this.queueDictionaryOperation(async () => {
      await this.ensureCustomWordsLoaded()
      return [...this.customWords.values()]
    })
  }

  async removeWord(word: string): Promise<RemoveWordResult> {
    return this.queueDictionaryOperation(async () => {
      const normalized = this.normalizeWord(word)
      if (!normalized) return 'invalid'

      await this.ensureCustomWordsLoaded()

      if (!this.customWords.has(normalized.canonical)) {
        return 'not_found'
      }

      this.customWords.delete(normalized.canonical)
      await this.persistCustomWords()
      await this.setup()

      if (this.linter) {
        try {
          await this.reimportAllWords()
        } catch (error) {
          log('Failed to rebuild dictionary after removal:', error)
        }
      }

      return 'removed'
    })
  }

  async clearCustomWords(): Promise<void> {
    await this.queueDictionaryOperation(async () => {
      await this.ensureCustomWordsLoaded()
      this.customWords.clear()
      await this.persistCustomWords()

      if (this.linter) {
        try {
          await this.linter.clearWords()
          await this.reimportEntityWords()
        } catch (error) {
          log('Failed to clear dictionary words:', error)
        }
      }
    })
  }

  private async reimportAllWords(): Promise<void> {
    if (!this.linter) return
    try {
      await this.linter.clearWords()
      const allWords = [...this.customWords.values(), ...this.entityWords]
      if (allWords.length > 0) {
        await this.linter.importWords(allWords)
      }
    } catch (error) {
      log('Failed to reimport words:', error)
    }
  }

  private async reimportEntityWords(): Promise<void> {
    if (!this.linter || this.entityWords.size === 0) return
    try {
      await this.linter.importWords([...this.entityWords])
    } catch (error) {
      log('Failed to reimport entity words:', error)
    }
  }

  async importEntityWords(names: string[]): Promise<void> {
    return this.queueDictionaryOperation(async () => {
      this.entityWords.clear()

      for (const name of names) {
        // Split multi-word names into individual words
        const words = name.split(/\s+/)
        for (const word of words) {
          const normalized = this.normalizeWord(word)
          if (normalized) {
            this.entityWords.add(normalized.display)
          }
        }
      }

      await this.setup()
      await this.reimportAllWords()
      log('Imported', this.entityWords.size, 'entity words into spell checker')
    })
  }

  async clearEntityWords(): Promise<void> {
    return this.queueDictionaryOperation(async () => {
      this.entityWords.clear()
      await this.reimportAllWords()
      log('Cleared entity words from spell checker')
    })
  }
}

export const grammarService = new GrammarService()
