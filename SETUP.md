# Setup Instructions for Anki MCP Server

## Step 1: Install Dependencies

```bash
cd /Users/ferdinandschweigert/Coding/anki
npm install
```

## Step 2: Build the Project

```bash
npm run build
```

## Step 3: Get Gemini API Key

1. Go to https://makersuite.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the API key

## Step 4: Install AnkiConnect in Anki Desktop

1. Open Anki Desktop
2. Go to Tools → Add-ons
3. Click "Get Add-ons"
4. Enter code: `2055492159`
5. Click "OK" and restart Anki

## Step 5: Configure Cursor MCP

1. In Cursor, press `Cmd+Shift+P` (or `Ctrl+Shift+P` on Windows/Linux)
2. Type "MCP: Edit Config" and select it
3. Add this configuration:

```json
{
  "mcpServers": {
    "anki": {
      "command": "node",
      "args": ["/Users/ferdinandschweigert/Coding/anki/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "YOUR_GEMINI_API_KEY_HERE"
      }
    }
  }
}
```

**Important:** Replace `YOUR_GEMINI_API_KEY_HERE` with your actual Gemini API key!

## Step 6: Restart Cursor

Close and reopen Cursor to load the MCP server.

## Step 7: Test It!

Once Cursor restarts, you can ask me (Adalbert):
- "List my Anki decks"
- "Read the deck at ~/Downloads/exam.apkg"
- "Enrich these cards with German explanations"
- "Sync them to my 'Prüfungsvorbereitung' deck"

## How It Connects

**MCP is NOT a CLI** - it's a background server that runs inside Cursor:

1. **MCP Server** (`dist/index.js`) runs as a background process
2. **Cursor** communicates with it via stdio (standard input/output)
3. **I (Adalbert)** can call the MCP tools to interact with:
   - Your .apkg files (read them)
   - Gemini API (enrich cards)
   - Anki Desktop via AnkiConnect (sync cards)

You never need to run commands manually - just talk to me!

## Anreicherung über die Website (lokal)

Die Website kann Karten direkt anreichern. So gehst du vor:

1. **Anki Desktop** und **AnkiConnect** laufen lassen.
2. **Website lokal starten:**
   ```bash
   cd website && npm install && npm run dev
   ```
3. **Gemini API-Key** in `website/.env.local`:
   ```
   GEMINI_API_KEY=dein-api-key
   ```
   API-Key: https://aistudio.google.com/apikey
4. Im Browser: http://localhost:3000
5. Im **Dashboard**:
   - Deck wählen (z.B. `TUD Klinik::9. Semester::Päd::Altfragen Pädiatrie`)
   - Im Block **„Karten anreichern“** die Anzahl setzen (z.B. 100)
   - Auf **„Erste 100 Karten anreichern“** klicken
6. Pro Batch werden 5 Karten verarbeitet (~1–2 Min. pro Batch). 100 Karten dauern etwa 30–40 Minuten.
7. Anschließend Vorschau prüfen und mit **„Zu Anki hinzufügen“** ins Ziel-Deck übernehmen (Standard: `Deckname (angereichert)`).

## Troubleshooting

### "Cannot connect to Anki Desktop"
- Make sure Anki Desktop is **running**
- Verify AnkiConnect is installed (Tools → Add-ons)
- Check that AnkiConnect is enabled

### "GEMINI_API_KEY not set"
- Make sure you added the API key to the Cursor MCP config
- Restart Cursor after adding the key

### "File not found"
- Use absolute paths or paths relative to your current directory
- You can use `~` for home directory (e.g., `~/Downloads/exam.apkg`)
