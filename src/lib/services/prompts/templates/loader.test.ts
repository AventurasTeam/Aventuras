import { describe, it, expect } from 'vitest'
import { parseLiquidTemplate } from './loader'

describe('parseLiquidTemplate', () => {
  it('parses frontmatter and system content', () => {
    const raw = `---
id: test-template
name: Test Template
category: service
description: A test template
---
System prompt here.`

    const result = parseLiquidTemplate(raw, 'test.liquid')
    expect(result.id).toBe('test-template')
    expect(result.name).toBe('Test Template')
    expect(result.category).toBe('service')
    expect(result.description).toBe('A test template')
    expect(result.content).toBe('System prompt here.')
    expect(result.userContent).toBeUndefined()
  })

  it('splits system and user content on ---USER--- delimiter', () => {
    const raw = `---
id: split-test
name: Split Test
category: story
description: Tests delimiter splitting
---
System content.

---USER---
User content.`

    const result = parseLiquidTemplate(raw, 'split.liquid')
    expect(result.content).toBe('System content.')
    expect(result.userContent).toBe('User content.')
  })

  it('trims leading/trailing whitespace from content sections', () => {
    const raw = `---
id: trim-test
name: Trim Test
category: service
description: Tests trimming
---

  System with whitespace.

---USER---

  User with whitespace.
`

    const result = parseLiquidTemplate(raw, 'trim.liquid')
    expect(result.content).toBe('System with whitespace.')
    expect(result.userContent).toBe('User with whitespace.')
  })

  it('throws on missing frontmatter', () => {
    const raw = 'No frontmatter here.'
    expect(() => parseLiquidTemplate(raw, 'bad.liquid')).toThrow('bad.liquid')
  })

  it('throws on missing required field', () => {
    const raw = `---
id: incomplete
name: Incomplete
---
Content.`

    expect(() => parseLiquidTemplate(raw, 'incomplete.liquid')).toThrow('category')
  })

  it('handles template with no user content', () => {
    const raw = `---
id: no-user
name: No User
category: image-style
description: Style only
---
Style content only.`

    const result = parseLiquidTemplate(raw, 'no-user.liquid')
    expect(result.content).toBe('Style content only.')
    expect(result.userContent).toBeUndefined()
  })

  it('preserves Liquid syntax in content', () => {
    const raw = `---
id: liquid-test
name: Liquid Test
category: service
description: Tests liquid preservation
---
Hello {{ name }}.
{% if condition %}yes{% endif %}
---USER---
{{ userAction }}`

    const result = parseLiquidTemplate(raw, 'liquid.liquid')
    expect(result.content).toContain('{{ name }}')
    expect(result.content).toContain('{% if condition %}')
    expect(result.userContent).toBe('{{ userAction }}')
  })
})
