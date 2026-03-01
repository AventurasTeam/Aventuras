# Aventuras

AI-powered interactive fiction and creative writing application built with Tauri, SvelteKit, and TypeScript.

## Features

### Story Modes

- **Adventure Mode** - Interactive fiction with multiple-choice actions and world tracking
- **Creative Writing Mode** - Freeform collaborative writing with AI-generated suggestions
- **POV Options** - First, second, or third person perspective
- **Tense Control** - Past or present tense narrative style

### AI Integration

- OpenRouter API integration for 70+ LLM providers and models
- Streaming responses with real-time text generation
- Configurable models, temperature, and token limits
- Extended thinking/reasoning support with configurable effort levels
- Custom API endpoints for OpenAI-compatible providers
- API profiles for saving multiple configurations

### Memory System

- Automatic chapter summarization to manage context windows
- Configurable token thresholds and chapter buffers
- Manual chapter creation and resummarization
- AI-powered memory retrieval for relevant past events
- Chapter metadata tracking (keywords, characters, locations, plot threads)
- In-story time tracking per chapter

### Lorebook

- Unified entry system for characters, locations, items, factions, concepts, and events
- Dynamic state tracking (relationships, inventory, discoveries)
- Keyword-based and relevance-based context injection
- Hidden information and secrets system
- Aliases for flexible entry referencing
- Import/export support (JSON, YAML, SillyTavern format)
- SillyTavern character card import (V1/V2 JSON and PNG)
- AI-assisted autonomous lore management agent

### Writing Tools

- Local grammar checking powered by Harper.js (WebAssembly)
- AI-powered style analysis for repetitive words and phrases
- Action suggestions that match player writing style
- Persistent action suggestions between sessions

### World Tracking

- Character relationships and dispositions with portrait support
- Location visits and changes with automatic discovery
- Inventory management with equipment tracking
- Quest/story beat progression (milestones, revelations, plot points)
- In-story time tracking (years, days, hours, minutes)
- Collapsible UI cards for all world elements

### Templates

- Built-in genre templates (fantasy, sci-fi, mystery, horror, slice of life)
- Custom template creation with system prompts
- Initial state configuration (protagonist, locations, items)
- Opening scene text support

### Image Generation

- Embedded image generation in story entries
- AI-powered imageable scene detection
- NanoGPT provider integration
- Character portrait support for visual consistency
- Configurable image size (512x512 or 1024x1024)

### Save and Restore

- Named checkpoints with full state snapshots
- Retry system for undoing actions and generating alternatives
- Character and time state preservation on retry

### Network Sync

- Local network sync between devices
- QR code connection for easy pairing
- Push/pull stories between devices
- Server mode for sharing stories

### UI Customization

- Multiple themes (dark, light, light solarized, retro console)
- Custom font selection (system or Google fonts)
- Adjustable text size (small, medium, large)
- Word count display toggle

### Cross-Platform

- Desktop (Windows, macOS, Linux)
- Android (APK)
- iOS (planned)

## Tech Stack

- **Frontend**: SvelteKit 5, TypeScript, Tailwind CSS
- **Backend**: Tauri 2 (Rust)
- **Database**: SQLite (via tauri-plugin-sql)
- **AI**: OpenRouter API
- **Grammar**: Harper.js (WASM)
- **Icons**: Lucide

## Installation

### Download Pre-built Binaries

Pre-compiled binaries are available on the [Releases](https://github.com/unkarelian/Aventuras/releases) page:

| Platform | Download                                  |
| -------- | ----------------------------------------- |
| Windows  | `aventuras_x.x.x_x64-setup.exe`           |
| macOS    | `aventuras_x.x.x_x64.dmg`                 |
| Linux    | `aventuras_x.x.x_amd64.deb` / `.AppImage` |
| Android  | `aventuras_x.x.x.apk`                     |

Simply download the appropriate file for your platform and install.

### Building from Source

<details>
<summary>Click to expand build instructions</summary>

#### Prerequisites

- Node.js 18+
- Rust (latest stable)
- For Android: Android SDK, NDK, Java 17+

#### Setup

```bash
# Clone the repository
git clone https://github.com/unkarelian/Aventuras.git
cd aventuras

# Install dependencies
npm install

# Run in development mode
npm run dev

# Or run with Tauri (desktop app)
npm run tauri dev
```

#### Building Desktop

```bash
npm run tauri build
```

#### Building Android

```bash
# Initialize Android target (first time only)
npm run tauri android init

# Build APK
npm run tauri android build -- --apk true
```

The unsigned APK will be at:

```
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
```

#### Signing APK

```bash
# Create keystore (first time only)
keytool -genkey -v -keystore release.keystore -alias myalias -keyalg RSA -keysize 2048 -validity 10000

# Align APK
zipalign -v 4 app-universal-release-unsigned.apk app-aligned.apk

# Sign APK
apksigner sign --ks release.keystore --ks-key-alias myalias --out app-release.apk app-aligned.apk
```

</details>

## Project Structure

```
aventuras/
├── src/
│   ├── lib/
│   │   ├── components/     # Svelte components
│   │   │   ├── layout/     # AppShell, Header, Sidebar
│   │   │   ├── story/      # StoryView, ActionInput, etc.
│   │   │   ├── lorebook/   # Lorebook management UI
│   │   │   ├── memory/     # Chapter/memory management
│   │   │   └── world/      # Character, Location, Inventory panels
│   │   ├── services/       # Business logic
│   │   │   ├── ai/         # AI services (OpenRouter, context, memory)
│   │   │   ├── database.ts # SQLite operations
│   │   │   └── grammar.ts  # Harper grammar checking
│   │   ├── stores/         # Svelte stores (state management)
│   │   └── types/          # TypeScript interfaces
│   └── routes/             # SvelteKit routes
├── src-tauri/              # Rust backend
│   ├── src/
│   └── Cargo.toml
├── static/                 # Static assets
└── package.json
```

## Configuration

### API Key Setup

1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Open Aventuras settings
3. Enter your API key in the API Settings section

### Memory Configuration

Per-story memory settings:

- **Token Threshold**: Context size before auto-summarization (default: 24,000)
- **Chapter Buffer**: Recent messages protected from chapter boundaries (default: 10)
- **Auto-Summarize**: Enable/disable automatic chapter creation

## Development

```bash
# Type checking
npm run check

# Watch mode type checking
npm run check:watch

# Build frontend only
npm run build

# Preview built frontend
npm run preview
```

## Acknowledgments

- [Tauri](https://tauri.app/) - Desktop/mobile app framework
- [SvelteKit](https://kit.svelte.dev/) - Frontend framework
- [OpenRouter](https://openrouter.ai/) - LLM API aggregator
- [Harper](https://writewithharper.com/) - Grammar checking
- [Lucide](https://lucide.dev/) - Icon library
