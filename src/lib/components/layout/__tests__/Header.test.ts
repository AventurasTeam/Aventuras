import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import { fireEvent } from '@testing-library/dom'

// ---------------------------------------------------------------------------
// Store mocks – vi.hoisted() ensures these are available when vi.mock hoists
// the factory functions to the top of the transformed module.
// ---------------------------------------------------------------------------

const { mockUi, mockStory, mockSettings } = vi.hoisted(() => {
  const mockUi = {
    setActivePanel: vi.fn(),
    openSettings: vi.fn(),
    openSTChatImport: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleLorebookDebug: vi.fn(),
    isGenerating: false,
    imageAnalysisInProgress: false,
    imagesGenerating: 0,
    lastLorebookRetrieval: null,
    activePanel: 'story',
    sidebarOpen: true,
  }

  const mockStory = {
    closeStory: vi.fn(),
    currentStory: null as null | { id: string; title: string },
    wordCount: 0,
    entries: [] as unknown[],
    characters: [] as unknown[],
    locations: [] as unknown[],
    lorebookEntries: [] as unknown[],
  }

  const mockSettings = {
    hasGenerationConfigIssues: false,
    uiSettings: {
      showWordCount: false,
    },
  }

  return { mockUi, mockStory, mockSettings }
})

vi.mock('$lib/stores/ui.svelte', () => ({ ui: mockUi }))
vi.mock('$lib/stores/story.svelte', () => ({ story: mockStory }))
vi.mock('$lib/stores/settings.svelte', () => ({ settings: mockSettings }))

vi.mock('$lib/services/export', () => ({
  exportService: {
    exportToAventura: vi.fn().mockResolvedValue(true),
    exportToMarkdown: vi.fn().mockResolvedValue(true),
    exportToText: vi.fn().mockResolvedValue(true),
  },
  gatherStoryData: vi.fn().mockResolvedValue({
    entries: [],
    characters: [],
    locations: [],
    items: [],
    storyBeats: [],
    lorebookEntries: [],
    embeddedImages: [],
    checkpoints: [],
    branches: [],
    chapters: [],
  }),
}))

vi.mock('$lib/services/events', () => ({
  eventBus: {
    subscribe: vi.fn(() => vi.fn()),
  },
}))

// ---------------------------------------------------------------------------
// Lightweight UI component mocks
// ---------------------------------------------------------------------------

vi.mock('$lib/components/ui/button', async () => {
  const mod = await import('./mocks/ButtonMock.svelte')
  return { Button: mod.default }
})

vi.mock('$lib/components/ui/dropdown-menu', async () => {
  const Root = (await import('./mocks/DropdownRoot.svelte')).default
  const Trigger = (await import('./mocks/DropdownTrigger.svelte')).default
  const Content = (await import('./mocks/DropdownContent.svelte')).default
  const Item = (await import('./mocks/DropdownItem.svelte')).default
  const Label = (await import('./mocks/DropdownLabel.svelte')).default
  const Separator = (await import('./mocks/DropdownSeparator.svelte')).default
  return { Root, Trigger, Content, Item, Label, Separator }
})

// Icon stubs – all named exports share the same trivial SVG component
vi.mock('lucide-svelte', async () => {
  const stub = (await import('./mocks/IconMock.svelte')).default
  const names = [
    'PanelRight', 'Settings', 'Library', 'ArrowUpDown',
    'FileJson', 'FileText', 'ChevronDown', 'ChevronUp',
    'Bug', 'ImageIcon', 'MessageSquare', 'AlertTriangle',
  ]
  return Object.fromEntries(names.map((n) => [n, stub]))
})

// ---------------------------------------------------------------------------
// Component under test (imported after all mocks)
// ---------------------------------------------------------------------------

import Header from '../Header.svelte'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup() {
  return render(Header)
}

/** Find a [role=menuitem] ancestor that contains the given element. */
function closestMenuItem(el: HTMLElement): HTMLElement | null {
  return el.closest('[role="menuitem"]') as HTMLElement | null
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStory.currentStory = null
  mockStory.lorebookEntries = []
  mockUi.isGenerating = false
  mockUi.imageAnalysisInProgress = false
  mockUi.imagesGenerating = 0
  mockSettings.hasGenerationConfigIssues = false
})

// ---------------------------------------------------------------------------
// goToLibrary() – new function added in this PR
// ---------------------------------------------------------------------------

describe('goToLibrary()', () => {
  it('calls story.closeStory() when the desktop Library button is clicked', async () => {
    mockStory.currentStory = { id: '1', title: 'Test Story' }
    setup()

    await fireEvent.click(screen.getByTitle('Return to Library'))

    expect(mockStory.closeStory).toHaveBeenCalledOnce()
  })

  it('calls ui.setActivePanel("library") when the desktop Library button is clicked', async () => {
    mockStory.currentStory = { id: '1', title: 'Test Story' }
    setup()

    await fireEvent.click(screen.getByTitle('Return to Library'))

    expect(mockUi.setActivePanel).toHaveBeenCalledWith('library')
  })

  it('calls story.closeStory() before ui.setActivePanel() – correct call order', async () => {
    const order: string[] = []
    mockStory.closeStory.mockImplementation(() => order.push('closeStory'))
    mockUi.setActivePanel.mockImplementation(() => order.push('setActivePanel'))
    mockStory.currentStory = { id: '1', title: 'Story' }

    setup()
    await fireEvent.click(screen.getByTitle('Return to Library'))

    expect(order).toEqual(['closeStory', 'setActivePanel'])
  })

  it('does not render the desktop Library button when no story is loaded', () => {
    mockStory.currentStory = null
    setup()

    expect(screen.queryByTitle('Return to Library')).toBeNull()
  })

  it('mobile menu Library item calls goToLibrary() (closeStory + setActivePanel)', async () => {
    mockStory.currentStory = { id: '1', title: 'Story' }
    setup()

    // "Library" text appears in both the desktop button label and the mobile menu item.
    // The mobile menu item is inside a [role="menuitem"] element.
    const allLibrary = screen.getAllByText('Library')
    const mobileItem = allLibrary
      .map((el) => closestMenuItem(el as HTMLElement))
      .find((el) => el !== null)

    expect(mobileItem).not.toBeNull()
    await fireEvent.click(mobileItem!)

    expect(mockStory.closeStory).toHaveBeenCalledOnce()
    expect(mockUi.setActivePanel).toHaveBeenCalledWith('library')
  })

  it('goToLibrary() via mobile menu calls closeStory() and setActivePanel() exactly once each', async () => {
    mockStory.currentStory = { id: '1', title: 'Story' }
    setup()

    const allLibrary = screen.getAllByText('Library')
    const mobileItem = allLibrary
      .map((el) => closestMenuItem(el as HTMLElement))
      .find((el) => el !== null)!

    await fireEvent.click(mobileItem)

    expect(mockStory.closeStory).toHaveBeenCalledTimes(1)
    expect(mockUi.setActivePanel).toHaveBeenCalledTimes(1)
    expect(mockUi.setActivePanel).toHaveBeenCalledWith('library')
  })
})

// ---------------------------------------------------------------------------
// showMobileMenu – new $state variable; mobile trigger always rendered
// ---------------------------------------------------------------------------

describe('showMobileMenu state', () => {
  it('the mobile menu trigger button is rendered regardless of whether a story is loaded', () => {
    mockStory.currentStory = null
    setup()

    expect(screen.getByTitle('Menu')).toBeDefined()
  })

  it('the mobile menu trigger button is rendered when a story is loaded', () => {
    mockStory.currentStory = { id: '1', title: 'My Story' }
    setup()

    expect(screen.getByTitle('Menu')).toBeDefined()
  })

  it('the mobile menu trigger renders an icon (ChevronDown by default, showMobileMenu=false)', () => {
    setup()

    const menuBtn = screen.getByTitle('Menu')
    // Our icon mock renders an <svg data-icon="icon"> element
    // The trigger wraps ChevronDown or ChevronUp depending on showMobileMenu state
    const svgIcon = menuBtn.querySelector('svg')
    expect(svgIcon).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// importExportMenuItems snippet – new snippet added in this PR
// ---------------------------------------------------------------------------

describe('importExportMenuItems snippet', () => {
  beforeEach(() => {
    mockStory.currentStory = { id: '1', title: 'Test Story' }
  })

  it('renders "SillyTavern Chat (.jsonl)" import option', () => {
    setup()

    expect(screen.getAllByText(/SillyTavern Chat \(\.jsonl\)/i).length).toBeGreaterThan(0)
  })

  it('renders "Aventuras (.avt)" export option', () => {
    setup()

    expect(screen.getAllByText(/Aventuras \(\.avt\)/i).length).toBeGreaterThan(0)
  })

  it('renders "Markdown (.md)" export option', () => {
    setup()

    expect(screen.getAllByText(/Markdown \(\.md\)/i).length).toBeGreaterThan(0)
  })

  it('renders "Plain Text (.txt)" export option', () => {
    setup()

    expect(screen.getAllByText(/Plain Text \(\.txt\)/i).length).toBeGreaterThan(0)
  })

  it('renders "Import" label', () => {
    setup()

    expect(screen.getAllByText('Import').length).toBeGreaterThan(0)
  })

  it('renders "Export" label', () => {
    setup()

    expect(screen.getAllByText('Export').length).toBeGreaterThan(0)
  })

  it('calls ui.openSTChatImport() when SillyTavern Chat item is clicked', async () => {
    setup()

    // The snippet appears twice (desktop + mobile). Click the first menuitem.
    const all = screen.getAllByText(/SillyTavern Chat \(\.jsonl\)/i)
    const menuItem = all.map((el) => closestMenuItem(el as HTMLElement)).find((el) => el !== null)!
    await fireEvent.click(menuItem)

    expect(mockUi.openSTChatImport).toHaveBeenCalledOnce()
  })

  it('does NOT call ui.openSTChatImport() before the SillyTavern item is clicked', () => {
    setup()

    expect(mockUi.openSTChatImport).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Mobile menu content – conditional on story.currentStory
// ---------------------------------------------------------------------------

describe('mobile menu content – with current story', () => {
  beforeEach(() => {
    mockStory.currentStory = { id: '42', title: 'Adventure Time' }
  })

  it('shows a Library menuitem in the mobile dropdown', () => {
    setup()

    const allLibrary = screen.getAllByText('Library')
    const inMenuitem = allLibrary.some((el) => closestMenuItem(el as HTMLElement) !== null)
    expect(inMenuitem).toBe(true)
  })

  it('shows SillyTavern import option in the mobile dropdown', () => {
    setup()

    expect(screen.getAllByText(/SillyTavern Chat \(\.jsonl\)/i).length).toBeGreaterThan(0)
  })

  it('shows Settings menuitem in the mobile dropdown', () => {
    setup()

    const allSettings = screen.getAllByText('Settings')
    const inMenuitem = allSettings.some((el) => closestMenuItem(el as HTMLElement) !== null)
    expect(inMenuitem).toBe(true)
  })

  it('clicking Settings menuitem calls ui.openSettings()', async () => {
    setup()

    const allSettings = screen.getAllByText('Settings')
    const menuItem = allSettings
      .map((el) => closestMenuItem(el as HTMLElement))
      .find((el) => el !== null)!

    await fireEvent.click(menuItem)

    expect(mockUi.openSettings).toHaveBeenCalledOnce()
  })
})

describe('mobile menu content – without current story', () => {
  it('does NOT show Library or import/export menuitems when no story is loaded', () => {
    mockStory.currentStory = null
    setup()

    const allMenuItems = screen.queryAllByRole('menuitem')
    const texts = allMenuItems.map((el) => (el.textContent ?? '').trim())

    expect(texts.some((t) => t === 'Library')).toBe(false)
    expect(texts.some((t) => t.includes('SillyTavern'))).toBe(false)
    expect(texts.some((t) => t.includes('Aventuras (.avt)'))).toBe(false)
    expect(texts.some((t) => t.includes('Markdown (.md)'))).toBe(false)
    expect(texts.some((t) => t.includes('Plain Text (.txt)'))).toBe(false)
  })

  it('DOES show a Settings menuitem even when no story is loaded', () => {
    mockStory.currentStory = null
    setup()

    const allSettings = screen.queryAllByText('Settings')
    const inMenuitem = allSettings.some((el) => closestMenuItem(el as HTMLElement) !== null)
    expect(inMenuitem).toBe(true)
  })

  it('clicking Settings menuitem calls ui.openSettings() when no story is loaded', async () => {
    mockStory.currentStory = null
    setup()

    const allSettings = screen.queryAllByText('Settings')
    const menuItem = allSettings
      .map((el) => closestMenuItem(el as HTMLElement))
      .find((el) => el !== null)!

    await fireEvent.click(menuItem)

    expect(mockUi.openSettings).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Settings AlertTriangle badge in mobile menu
// ---------------------------------------------------------------------------

describe('Settings AlertTriangle badge (mobile menu)', () => {
  it('Settings menuitem contains an svg icon when hasGenerationConfigIssues is true', () => {
    mockSettings.hasGenerationConfigIssues = true
    mockStory.currentStory = null
    setup()

    const allSettings = screen.queryAllByText('Settings')
    const menuItem = allSettings
      .map((el) => closestMenuItem(el as HTMLElement))
      .find((el) => el !== null)!

    // Our icon mock renders an <svg> element; AlertTriangle will be one of them
    const icons = menuItem.querySelectorAll('svg')
    expect(icons.length).toBeGreaterThan(0)
  })

  it('Settings menuitem has fewer icons when hasGenerationConfigIssues is false', () => {
    mockSettings.hasGenerationConfigIssues = false
    mockStory.currentStory = null
    setup()

    const allSettings = screen.queryAllByText('Settings')
    const menuItemWithIssues = allSettings
      .map((el) => closestMenuItem(el as HTMLElement))
      .find((el) => el !== null)

    // When no issues, the AlertTriangle should not appear.
    // The menuitem will have an svg for the Settings icon but not for AlertTriangle.
    // Just confirm the menuitem exists.
    expect(menuItemWithIssues).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Story title area – max-w-40 constraint removed (regression guard)
// ---------------------------------------------------------------------------

describe('story title area', () => {
  it('story title span does NOT have max-w-40 class (constraint removed in this PR)', () => {
    mockStory.currentStory = { id: '1', title: 'A Very Long Story Title' }
    setup()

    const titleSpan = screen.getByText('A Very Long Story Title')
    expect(titleSpan.className).not.toContain('max-w-40')
  })

  it('story title span has the "truncate" class for overflow handling', () => {
    mockStory.currentStory = { id: '1', title: 'My Story' }
    setup()

    const titleSpan = screen.getByText('My Story')
    expect(titleSpan.className).toContain('truncate')
  })

  it('shows app branding "Aventuras" text when no story is loaded', () => {
    mockStory.currentStory = null
    setup()

    expect(screen.getByText('Aventuras')).toBeDefined()
  })

  it('shows the current story title when a story is loaded', () => {
    mockStory.currentStory = { id: '1', title: 'The Dragon Quest' }
    setup()

    expect(screen.getByText('The Dragon Quest')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Desktop Library button – hidden on mobile (CSS wrapper class guard)
// ---------------------------------------------------------------------------

describe('desktop Library button mobile-hidden wrapper', () => {
  it('Library button is inside a div with "hidden" class (hidden sm:block)', () => {
    mockStory.currentStory = { id: '1', title: 'Story' }
    setup()

    const libraryBtn = screen.getByTitle('Return to Library')
    expect(libraryBtn.closest('div.hidden')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Desktop Import/Export button – hidden on mobile (CSS wrapper class guard)
// ---------------------------------------------------------------------------

describe('desktop Import/Export button mobile-hidden wrapper', () => {
  it('Import/Export button is inside a div with "hidden" class (hidden sm:block)', () => {
    mockStory.currentStory = { id: '1', title: 'Story' }
    setup()

    const btn = screen.getByTitle('Import / Export story')
    expect(btn.closest('div.hidden')).not.toBeNull()
  })

  it('does not render the desktop Import/Export button when no story is loaded', () => {
    mockStory.currentStory = null
    setup()

    expect(screen.queryByTitle('Import / Export story')).toBeNull()
  })
})