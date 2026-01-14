# Anki MCP Server - Adalbert

An MCP (Model Context Protocol) server that enriches Anki exam decks with AI-generated German explanations using Gemini API.

## How It Works

**MCP is NOT a CLI** - it's a background server that runs in Cursor. When you talk to me (Adalbert), I can call these tools to:
- Read your exam .apkg files
- Enrich cards with German explanations via Gemini API
- Sync enriched cards directly to Anki Desktop (no import/export!)

## Quick Start

See [SETUP.md](SETUP.md) for detailed installation instructions.

## Prerequisites

1. **Anki Desktop** with **AnkiConnect add-on** installed
   - Install AnkiConnect: Code `2055492159` in Anki
   - Make sure Anki Desktop is running

2. **Gemini API Key** (free tier)
   - Get it at: https://makersuite.google.com/app/apikey

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

3. Configure Cursor MCP (see [SETUP.md](SETUP.md) for details)

4. Restart Cursor

## Usage

Once configured, just ask me (Adalbert):
- "List my Anki decks"
- "Read the exam deck at ~/Downloads/klausur.apkg"
- "Enrich these cards with German explanations"
- "Sync the enriched cards to my 'Prüfungsvorbereitung' deck"

## Card Enrichment

Each card gets:
- **Original question** (front)
- **Original answer** (back)
- **📚 ERKLÄRUNG** - Detailed German explanation
- **💡 ESELSBRÜCKE** - Memory aids when applicable

## How It Connects

The MCP server runs as a background process that Cursor communicates with. You never need to run commands manually - just talk to me and I'll handle everything!
